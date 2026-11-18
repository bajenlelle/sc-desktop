// Copy for the welcome and onboarding_reminder emails. Pure: no Deno globals,
// no imports, so node:test can run it. Swedish is read by Leonard before ship.

export type OnboardingKind = "welcome" | "onboarding_reminder";
export type Lang = "sv" | "en";

export function normalizeLang(v: string | undefined): Lang {
  return v === "sv" ? "sv" : "en";
}

interface LangCopy {
  greeting: (name: string) => string;
  welcome: { subject: string; heading: string; body: string; footer: string };
  reminder: { subject: string; heading: string; body: string; footer: string };
  coach: string;
  player: string;
  noRole: string;
  mac: string;
  windows: string;
  unsubscribe: string;
}

const COPY: Record<Lang, LangCopy> = {
  sv: {
    greeting: (n) => `Hej ${n},`,
    welcome: {
      subject: "Scoutable på din dator",
      heading: "Öppna Scoutable på din dator",
      body: "Scoutable är en app för Mac och Windows. Ladda ner den på datorn och logga in med den här e-postadressen.",
      footer: "Du får det här mejlet för att du skapade ett konto hos Scoutable.",
    },
    reminder: {
      subject: "Dina två gratismatcher väntar",
      heading: "Dina två gratismatcher väntar",
      body: "Du har ett Scoutable-konto men har inte öppnat appen på datorn än. Ladda ner den och logga in med den här e-postadressen.",
      footer: "Du får det här mejlet för att du har ett konto hos Scoutable.",
    },
    coach: "Två matcher är gratis. Importera en match så är varje situation klippt och klar att dela med laget.",
    player: "Två matcher är gratis. Dra in din matchvideo så tar Scoutable automatiskt fram allt med ditt namn.",
    noRole: "Två matcher är gratis.",
    mac: "Ladda ner för Mac",
    windows: "Ladda ner för Windows",
    unsubscribe: "Avregistrera dig från tips och erbjudanden",
  },
  en: {
    greeting: (n) => `Hi ${n},`,
    welcome: {
      subject: "Get Scoutable on your computer",
      heading: "Get Scoutable on your computer",
      body: "Scoutable is an app for Mac and Windows. Download it on your computer and sign in with this email address.",
      footer: "You're getting this because you created a Scoutable account.",
    },
    reminder: {
      subject: "Your two free games are waiting",
      heading: "Your two free games are waiting",
      body: "You have a Scoutable account but haven't opened the app on your computer yet. Download it and sign in with this email address.",
      footer: "You're getting this because you have a Scoutable account.",
    },
    coach: "Two games are free. Import a game and every play is clipped and ready to share with your team.",
    player: "Two games are free. Drop in your game video and Scoutable automatically finds everything with your name on it.",
    noRole: "Two games are free.",
    mac: "Download for Mac",
    windows: "Download for Windows",
    unsubscribe: "Unsubscribe from tips and offers",
  },
};

export function onboardingCopy(
  kind: OnboardingKind,
  lang: Lang,
  role: string | undefined,
  firstName: string | undefined,
): {
  subject: string;
  heading: string;
  greeting: string | null;
  body: string;
  roleLine: string;
  mac: string;
  windows: string;
  footer: string;
  unsubscribe: string;
} {
  const c = COPY[normalizeLang(lang)];
  const k = kind === "welcome" ? c.welcome : c.reminder;
  const name = firstName?.trim();
  return {
    subject: k.subject,
    heading: k.heading,
    greeting: name ? c.greeting(name) : null,
    body: k.body,
    roleLine: role === "coach" ? c.coach : role === "player" ? c.player : c.noRole,
    mac: c.mac,
    windows: c.windows,
    footer: k.footer,
    unsubscribe: c.unsubscribe,
  };
}
