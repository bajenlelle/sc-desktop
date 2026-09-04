//! Native macOS menu bar.
//!
//! Built once at startup (before the webview loads, so there is no flash of
//! Tauri's default menu and it survives webview reloads). Custom items emit a
//! single "menu" event with their id; src/components/menu-handler.tsx maps ids
//! to actions. Keep the id list below in sync with MENU_IDS there.
//!
//! macOS only: Windows would render this as an in-window menu bar, which the
//! app has never had — the commands compile everywhere but no-op off macOS.

#[cfg(target_os = "macos")]
use std::collections::HashMap;

#[cfg(target_os = "macos")]
use tauri::{
    menu::{
        AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem,
        MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
    },
    AppHandle, Emitter, Manager, Wry,
};

/// Handles to every item the frontend can mutate after startup.
#[cfg(target_os = "macos")]
pub struct MenuHandles {
    items: HashMap<&'static str, MenuItem<Wry>>,
    appearance: HashMap<&'static str, CheckMenuItem<Wry>>,
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
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_playlist)
        .item(&add_game)
        .separator()
        .item(&export_playlist)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
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

    let toggle_browser = item("toggle-playlist-browser", "Toggle Playlist Browser", Some("CmdOrCtrl+B"))?;
    // Player fullscreen (stage + clip controls) — distinct from the
    // predefined window fullscreen below, which just resizes the window.
    let fullscreen_player = item("fullscreen-player", "Fullscreen Player", Some("CmdOrCtrl+Shift+F"))?;
    let zoom_in = item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?;
    let zoom_out = item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?;
    let zoom_reset = item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?;
    let view_menu = SubmenuBuilder::new(app, "View")
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
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
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

    app.manage(MenuHandles { items, appearance });
    Ok(())
}

/// Custom items reach the webview as a single "menu" event carrying the id;
/// predefined items are handled natively and never arrive here.
#[cfg(target_os = "macos")]
pub fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    if let Err(e) = app.emit_to("main", "menu", id) {
        eprintln!("[menu] failed to emit menu event {id}: {e}");
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
