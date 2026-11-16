//! Native macOS menu bar.
//!
//! Built once at startup (before the webview loads, so there is no flash of
//! Tauri's default menu and it survives webview reloads). Custom items emit a
//! single "menu" event with their id; src/components/menu-handler.tsx maps ids
//! to actions. Keep the id list below in sync with MENU_IDS there. The one
//! exception is Close Window, which this file closes itself.
//!
//! macOS only: Windows would render this as an in-window menu bar, which the
//! app has never had — the commands compile everywhere but no-op off macOS.

#[cfg(target_os = "macos")]
use std::collections::HashMap;

#[cfg(target_os = "macos")]
use tauri::{
    menu::{
        AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem,
        MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
    },
    AppHandle, Emitter, Manager, Wry,
};

/// The File menu's Close Window: closed natively (see `on_menu_event`).
#[cfg(target_os = "macos")]
const CLOSE_WINDOW: &str = "close-window";
/// The File menu's Close Tab, in the menu only while the game page has two tabs
/// or more: with one game its tab is there, but there is no tab to close to.
#[cfg(target_os = "macos")]
const CLOSE_TAB: &str = "close-tab";
/// Where Close Tab goes in the File menu: right above Close Window, after
/// New Playlist, Add Game, a separator, Export Playlist, a separator, New Tab
/// and Reopen Closed Tab.
#[cfg(target_os = "macos")]
const CLOSE_TAB_POSITION: usize = 7;

/// The items on ⌘W close what is in front, so they are for the main window
/// only while it is the window in front (see `on_menu_event`).
#[cfg(target_os = "macos")]
fn closes_what_is_in_front(id: &str) -> bool {
    id == CLOSE_WINDOW || id == CLOSE_TAB
}

/// What choosing a menu item does.
#[cfg(target_os = "macos")]
#[derive(Debug, PartialEq)]
enum MenuAct {
    /// Not for the main window right now.
    Nothing,
    /// Closed here: it has to work where nothing in the webview listens.
    CloseWindow,
    /// Sent to the page as a "menu" event.
    ToPage,
}

/// `main_in_front`: the main window is the one in front. With the About
/// panel or a file dialog in front, ⌘W is not for the window behind it (which
/// would quit the app, or close a game's tab out of sight).
#[cfg(target_os = "macos")]
fn menu_act(id: &str, main_in_front: bool) -> MenuAct {
    if closes_what_is_in_front(id) {
        if !main_in_front {
            return MenuAct::Nothing;
        }
        if id == CLOSE_WINDOW {
            return MenuAct::CloseWindow;
        }
    }
    MenuAct::ToPage
}

/// Handles to every item the frontend can mutate after startup.
#[cfg(target_os = "macos")]
pub struct MenuHandles {
    items: HashMap<&'static str, MenuItem<Wry>>,
    appearance: HashMap<&'static str, CheckMenuItem<Wry>>,
    /// The File menu, and whether Close Tab is in it now (`menu_game_tabs`).
    file: Submenu<Wry>,
    close_tab_shown: std::sync::atomic::AtomicBool,
}

#[cfg(target_os = "macos")]
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let mut items: HashMap<&'static str, MenuItem<Wry>> = HashMap::new();

    let mut item = |id: &'static str, label: &str, accel: Option<&str>| -> tauri::Result<MenuItem<Wry>> {
        let mut b = MenuItemBuilder::with_id(id, label);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        let i = b.build(app)?;
        items.insert(id, i.clone());
        Ok(i)
    };

    // -- Scoutable (app menu; macOS titles it with the app name) --------------
    let about_meta = AboutMetadata {
        version: Some(app.package_info().version.to_string()),
        copyright: Some("© Scoutable".into()),
        ..Default::default()
    };
    let check_updates = item("check-updates", "Check for Updates…", None)?;
    let settings = item("settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let sign_out = item("sign-out", "Sign Out", None)?;
    let app_menu = SubmenuBuilder::new(app, "Scoutable")
        .item(&PredefinedMenuItem::about(app, Some("About Scoutable"), Some(about_meta))?)
        .separator()
        .item(&check_updates)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&sign_out)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // -- File ------------------------------------------------------------------
    let new_playlist = item("new-playlist", "New Playlist", Some("CmdOrCtrl+N"))?;
    let add_game = item("add-game", "Add Game…", Some("CmdOrCtrl+O"))?;
    let export_playlist = item("export-playlist", "Export Playlist…", Some("CmdOrCtrl+E"))?;
    // Close Tab and Close Window, as Safari has them. While the game page shows
    // its tabs, ⌘W closes the tab and ⇧⌘W the window; otherwise there is no
    // Close Tab and ⌘W closes the window (`menu_game_tabs`). Close Window is a
    // custom item because a predefined item's accelerator can't be changed.
    // Close Tab is made here, with ⌘W, and put in the menu only while there
    // are tabs: an item's accelerator can be changed but not taken away
    // (muda's `set_accelerator(None)` leaves the key in place on macOS), and
    // two items in a menu must never share ⌘W.
    item(CLOSE_TAB, "Close Tab", Some("CmdOrCtrl+W"))?;
    let close_window = item(CLOSE_WINDOW, "Close Window", Some("CmdOrCtrl+W"))?;
    // The game page's tabs, as a browser has them: New Tab opens its game
    // picker (on only on the game page), Reopen Closed Tab brings back the
    // tab closed last (on while there is one). Both start off; the webview
    // turns them on (`menu_set_enabled`).
    let new_game_tab = item("new-game-tab", "New Tab", Some("CmdOrCtrl+T"))?;
    new_game_tab.set_enabled(false)?;
    let reopen_game_tab = item("reopen-game-tab", "Reopen Closed Tab", Some("CmdOrCtrl+Shift+T"))?;
    reopen_game_tab.set_enabled(false)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_playlist)
        .item(&add_game)
        .separator()
        .item(&export_playlist)
        .separator()
        .item(&new_game_tab)
        .item(&reopen_game_tab)
        .item(&close_window)
        .build()?;

    // -- Edit — predefined items are mandatory: without them ⌘C/⌘V/⌘Z stop
    //    working in every WKWebView text field.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // -- View --------------------------------------------------------------
    let mut appearance: HashMap<&'static str, CheckMenuItem<Wry>> = HashMap::new();
    for (id, label) in [
        ("appearance-light", "Light"),
        ("appearance-dark", "Dark"),
        ("appearance-system", "System"),
    ] {
        appearance.insert(id, CheckMenuItemBuilder::with_id(id, label).checked(false).build(app)?);
    }
    let appearance_menu = SubmenuBuilder::new(app, "Appearance")
        .item(&appearance["appearance-light"])
        .item(&appearance["appearance-dark"])
        .item(&appearance["appearance-system"])
        .build()?;

    // Show/Hide titles: menu-handler.tsx swaps them as each panel opens or closes.
    let toggle_sidebar = item("toggle-sidebar", "Hide Sidebar", Some("Ctrl+Cmd+S"))?;
    let toggle_browser = item("toggle-playlist-browser", "Hide Playlists", Some("CmdOrCtrl+B"))?;
    // Player fullscreen (stage + clip controls) — distinct from the
    // predefined window fullscreen below, which just resizes the window.
    let fullscreen_player = item("fullscreen-player", "Fullscreen Player", Some("CmdOrCtrl+Shift+F"))?;
    let zoom_in = item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?;
    let zoom_out = item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?;
    let zoom_reset = item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .item(&toggle_browser)
        .item(&fullscreen_player)
        .separator()
        .item(&appearance_menu)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // -- Go ------------------------------------------------------------------
    let go_home = item("go-home", "Home", Some("CmdOrCtrl+1"))?;
    let go_playlists = item("go-playlists", "Playlists", Some("CmdOrCtrl+2"))?;
    let go_my_playlists = item("go-my-playlists", "Shared Playlists", Some("CmdOrCtrl+3"))?;
    let go_library = item("go-library", "Library", Some("CmdOrCtrl+4"))?;
    let go_organization = item("go-organization", "Organization", Some("CmdOrCtrl+5"))?;
    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&go_home)
        .item(&go_playlists)
        .item(&go_my_playlists)
        .item(&go_library)
        .separator()
        .item(&go_organization)
        .build()?;

    // -- Window ------------------------------------------------------------
    // The game page's tabs, as Safari's Show Next/Previous Tab; on only there.
    let game_tab_prev = item("game-tab-prev", "Show Previous Game Tab", Some("CmdOrCtrl+Shift+["))?;
    let game_tab_next = item("game-tab-next", "Show Next Game Tab", Some("CmdOrCtrl+Shift+]"))?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&game_tab_prev)
        .item(&game_tab_next)
        .build()?;
    window_menu.set_as_windows_menu_for_nsapp()?;

    // -- Help ---------------------------------------------------------------
    let send_feedback = item("send-feedback", "Send Feedback…", None)?;
    let open_website = item("open-website", "Scoutable Website", None)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&send_feedback)
        .separator()
        .item(&open_website)
        .build()?;
    help_menu.set_as_help_menu_for_nsapp()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&go_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;

    app.manage(MenuHandles {
        items,
        appearance,
        file: file_menu,
        close_tab_shown: std::sync::atomic::AtomicBool::new(false),
    });
    Ok(())
}

/// Custom items reach the webview as a single "menu" event carrying the id;
/// predefined items are handled natively and never arrive here. Close Window
/// is closed here: it has to work on every screen, also where nothing in the
/// webview listens (sign-in, the crash screen).
#[cfg(target_os = "macos")]
pub fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    let window = app.get_webview_window("main");
    let main_in_front = window
        .as_ref()
        .is_some_and(|w| w.is_focused().unwrap_or(true));
    match menu_act(id, main_in_front) {
        MenuAct::Nothing => {}
        MenuAct::CloseWindow => {
            if let Some(Err(e)) = window.map(|w| w.close()) {
                eprintln!("[menu] failed to close the window: {e}");
            }
        }
        MenuAct::ToPage => {
            if let Err(e) = app.emit_to("main", "menu", id) {
                eprintln!("[menu] failed to emit menu event {id}: {e}");
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn on_menu_event(_app: &tauri::AppHandle, _event: tauri::menu::MenuEvent) {}

/// Enable/disable a menu item (role/route gating from the frontend).
#[tauri::command]
pub fn menu_set_enabled(app: tauri::AppHandle, id: String, enabled: bool) {
    #[cfg(target_os = "macos")]
    {
        if let Some(handles) = app.try_state::<MenuHandles>() {
            if let Some(i) = handles.items.get(id.as_str()) {
                let _ = i.set_enabled(enabled);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, id, enabled);
    }
}

/// The game page's tab bar came or went. While it is there the File menu has
/// Close Tab on ⌘W and Close Window on ⇧⌘W, as in Safari; without it there is
/// no Close Tab and ⌘W closes the window, as everywhere else in the app.
#[tauri::command]
pub fn menu_game_tabs(app: tauri::AppHandle, shown: bool) {
    #[cfg(target_os = "macos")]
    {
        use std::sync::atomic::Ordering;
        let Some(handles) = app.try_state::<MenuHandles>() else {
            return;
        };
        if handles.close_tab_shown.swap(shown, Ordering::SeqCst) == shown {
            return;
        }
        let (Some(tab), Some(window)) = (handles.items.get(CLOSE_TAB), handles.items.get(CLOSE_WINDOW)) else {
            return;
        };
        // Never both on ⌘W: Close Window gives it up before Close Tab comes
        // in, and takes it back once Close Tab is out.
        if shown {
            let _ = window.set_accelerator(Some("CmdOrCtrl+Shift+W"));
            let _ = handles.file.insert(tab, CLOSE_TAB_POSITION);
        } else {
            let _ = handles.file.remove(tab);
            let _ = window.set_accelerator(Some("CmdOrCtrl+W"));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, shown);
    }
}

/// Retitle a menu item (Show/Hide Sidebar follows the panel it toggles).
#[tauri::command]
pub fn menu_set_text(app: tauri::AppHandle, id: String, text: String) {
    #[cfg(target_os = "macos")]
    {
        if let Some(handles) = app.try_state::<MenuHandles>() {
            if let Some(i) = handles.items.get(id.as_str()) {
                let _ = i.set_text(text);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, id, text);
    }
}

/// Reflect the current next-themes value in the Appearance checkmarks.
/// next-themes stays the single source of truth; the menu is a projection.
#[tauri::command]
pub fn menu_sync_theme(app: tauri::AppHandle, theme: String) {
    #[cfg(target_os = "macos")]
    {
        if let Some(handles) = app.try_state::<MenuHandles>() {
            for (id, item) in &handles.appearance {
                let checked = id.ends_with(theme.as_str());
                let _ = item.set_checked(checked);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, theme);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn close_tab_and_close_window_are_for_the_window_in_front() {
        // Behind the About panel or a file dialog, ⌘W is not for the main window.
        assert_eq!(menu_act(CLOSE_TAB, false), MenuAct::Nothing);
        assert_eq!(menu_act(CLOSE_WINDOW, false), MenuAct::Nothing);
        // In front, Close Window closes it here and Close Tab goes to the page.
        assert_eq!(menu_act(CLOSE_WINDOW, true), MenuAct::CloseWindow);
        assert_eq!(menu_act(CLOSE_TAB, true), MenuAct::ToPage);
        // The rest act on the main window whatever is in front of it, as in Safari.
        assert_eq!(menu_act("new-game-tab", false), MenuAct::ToPage);
        assert_eq!(menu_act("reopen-game-tab", false), MenuAct::ToPage);
        assert_eq!(menu_act("new-game-tab", true), MenuAct::ToPage);
    }
}
