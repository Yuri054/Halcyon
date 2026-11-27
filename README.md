# Halcyon

A console-style game launcher for Linux. Big tiles, horizontal rails, and a dashboard you can drive
entirely from a controller. Steam, emulators and anything else you can start from a command.

[![Watch the Halcyon trailer](docs/trailer.png)](docs/Halcyon-trailer.mp4)

![Home](docs/home.png)

## Install

Download the latest build from [Releases](https://github.com/Yuri054/Halcyon/releases):

- **AppImage** (any distribution): make it executable and run it.

  ```bash
  chmod +x Halcyon-1.0.0-x86_64.AppImage
  ```

  ```bash
  ./Halcyon-1.0.0-x86_64.AppImage
  ```

- **.deb** (Debian, Ubuntu, Pop!_OS, Mint): install it, then start Halcyon from the app menu.

  ```bash
  sudo apt install ./Halcyon-1.0.0-amd64.deb
  ```

Settings and artwork live in `~/.config/Halcyon` either way.

## Run from source

```bash
npm install
```

```bash
npm start
```

`npm run windowed` starts in a window instead of fullscreen. `scripts/install-desktop.sh` adds
Halcyon to your application menu. `npm run dist` builds the AppImage and .deb into `dist/`.

## Controls

| Action | Controller | Keyboard |
| --- | --- | --- |
| Move | D-pad / left stick | Arrow keys |
| Select / play | A | Enter |
| Back | B | Esc |
| Favorite | X | F |
| Game options | Y | Tab |
| Switch section | LB / RB | Q / E |
| Page the wall / cycle category | LT / RT | PgUp / PgDn |
| Search | Start | / |
| Sort | Select | Home |
| Guide | Home / Guide button, or B on home | G or F1 |
| In-game menu | Home, or Select + Start (hold Home to quit) | – |
| Fullscreen | – | F11 |

Controllers can be plugged in or removed at any time. Input is ignored while Halcyon is in the
background, so playing a game never moves the dashboard. Text entry uses an on-screen keyboard and
file picking uses a built-in browser, so no mouse or keyboard is ever required.

## Console behaviour

- **Guide** — opens from anywhere on the Home button (G or F1 on a keyboard) as a set of blades,
  like the console's: *games & apps* (recent games, all games), *home* (Halcyon Home, downloads,
  search, store, collections, and Resume / Quit for a running game), *downloads* (a live progress
  card and what's next) and *settings* (volume, settings, sleep, restart, shut down, exit). Left /
  right or LB / RB move between blades; Y goes to Halcyon Home. If Steam is running it may claim
  the Guide button for itself; B on the home screen opens the same menu.
- **Now playing** — a started game keeps its card up until it exits, then Halcyon comes back to
  the front. Steam games are followed through Steam's own launch process; time played in
  emulators and custom games is recorded per session.
- **Start-up** — a short power-on animation and chime (any button skips it; it can be turned off),
  and *Start Halcyon on login* in Settings to boot straight into the dashboard.
- **Idle** — the screen dims to a drifting clock after five minutes; the first press only wakes it.
  The pointer hides unless the mouse is moving, and background animation rests while a game runs.
- **Controller battery** — shown in the top bar for pads that report one, with a low-battery notice.

## Steam store, uninstalled games and downloads

- **Store** (its own section). Steam's front page as rails (on sale, top sellers, new releases,
  coming soon) plus search, from Steam's public store listings. A game's page shows price,
  description, controller support and whether it is native or runs through Proton. *Buy in Steam*
  opens that page in the Steam client: Halcyon never handles your login or payment.
- **Games you own but have not installed** (Settings › steam › *Steam Web API key*). With a free
  key from steamcommunity.com/dev/apikey, Halcyon asks Steam what the signed-in account owns and
  shows the rest of your library greyed out under Games › *Not installed*. Selecting one asks
  Steam to install it; Steam shows its own dialog for where to put it. The key is sent to Steam
  in a request header and stored in the owner-only config file. A private "game details" setting
  on your Steam profile makes Steam answer with an empty list.
- **Downloads.** Tiles show "Downloading 43%", queued, paused and installing states read from
  Steam's own manifests every few seconds, with a list in the Guide and a notice when a game is
  ready. *Uninstall* and *View in the Steam store* are in each Steam game's options menu; Steam
  confirms an uninstall itself.

## Steam download manager

Guide › *Downloads* (also Settings › steam › *Downloads*, and *Manage download* on a game that is
downloading) shows Steam's queue. With **Download controls** on (Settings › steam) it can pause and
resume a download, start one now, move it up, down or to the top, remove it, pause or resume all
downloads, start a waiting update, and clear finished ones.

Download controls use Steam's own interface through its debugging port, the same method Decky
Loader uses: Halcyon puts a `.cef-enable-remote-debugging` file in your Steam folder (removed again
when you turn the setting off) and Steam opens the port on its next start. **While it is on, any
program on this computer can control Steam, including the store**; it does not accept connections
from other computers. These are undocumented Steam internals: if a Steam update changes them, the
controls report an error and the manager falls back to showing progress only.

## Media (Jellyfin)

Two sections, **tv & movies** and **music**, play from your own Jellyfin server. Select *Connect
to Jellyfin* (on either) and enter the server address, user name and password on the on-screen keyboard; the
password is used once to sign in and is not stored, and the session token stays in the main
process (images and streams reach the page through a `jf://` protocol that adds it).

- **Home:** a featured title, library tiles, continue watching, next up and what's new in each
  library, plus search and the server (refresh, sign out).
- **Details:** selecting a movie or show opens its own page: backdrop, logo, year, rating, genres,
  tagline, cast, and buttons to resume, play from the start, mark watched/unwatched or remove it
  from continue watching. A show lists its seasons (LT/RT to switch) and their episodes.
- **Y on any tile:** play/resume, details, go to the series, mark watched, or remove from
  continue watching (Jellyfin's own "hide from resume", so its other apps agree).
- **Libraries:** a wall of posters with genre chips along the top; LT/RT step through genres.
- **Music:** the music section opens on Albums / Artists / Playlists tiles, the newest album,
  recently played songs and your playlists. A music library shows albums, artists or playlists (LT/RT to switch). An artist lists
  their albums with *Shuffle all songs*; albums and playlists list their songs with *Play* and
  *Shuffle*. Songs play on a now-playing screen with the cover, artist, album and what's next.
  B leaves the music playing while you browse (the song shows by the clock); the Guide or the
  *Now playing* tile on the music page brings the screen back, and X stops it. Starting a game
  or a video stops it too.
- **Player:** A pause/play, left/right skip back 10 s / forward 30 s (hold for bigger jumps),
  the right stick changes the volume (up/down and every other button bring the bar back), X subtitles, Y audio track and subtitles
  (another language or commentary track is served by Jellyfin with that track), LB/RB
  previous/next, B stop. The bar
  and the button prompts fade away while the picture plays and come back on any press. Files
  Chromium can play are played as they are; anything else Jellyfin transcodes to HLS, played with
  hls.js. Jellyfin is told where you are, so resume points and "next up" stay in step with its
  other apps.

The 360 theme's home is laid out like the console's dashboard: the page of big and small tiles,
the search tab peeking in at the left, and the next page waiting at the right edge; moving onto it
slides the whole page across.

## PC ports and recomps

Games installed with **Quiver Launcher** (decomp ports and recomps, such as Dusklight) appear
in Halcyon by themselves, under Games › *PC ports*: Halcyon reads Quiver's list (`apps.json`
beside its AppImage, by default `~/AppImages`) and starts each game straight from its AppImage.
A port is listed by its own name (Dusklight), and if the same game is also there as a ROM, the
ROM steps aside so only the port shows. Its artwork comes from SteamGridDB automatically (found by
the original game's title), as for games added by hand.

**Add a game** (home or Settings) now lists the computer's installed games (desktop entries in
the Game category that Halcyon doesn't already have) to add in one step, opens Quiver Launcher,
or takes any program by hand.

## 360 theme options

Settings › display › *Theme options* (right under Theme, in the 360 theme) turns each of the
theme's touches on or off: a lime focus glow (green frame, glow and lift on the selected tile),
names on every cover, flat Metro buttons for Show / Search / Sort, roomier covers, a position
count with a fade at the list's right edge, a faint wash of the selected game's art behind the
top of the screen, and a profile corner by the clock (Steam picture and name, with hours played
and games installed in place of a Gamerscore).

## Home tiles

The home page's tile section starts with **Games, Settings and Power**. Y on a tile moves it left
or right or removes it; the **+** tile adds one from the catalog (favorites, recently played,
Steam, emulated, PC ports, achievements, TV & movies, music, downloads, storage, search, add a
game, Open Steam, Big Picture). *Back to the usual tiles* resets it.

## Achievements

With a Steam Web API key (Settings › steam), a Steam game's options show its achievements count
and open the full list: unlocked first (newest first, with the date), then locked (the most common
first, with how many players have it; hidden ones stay hidden until earned). The Guide and a home
tile open every game with achievements. Halcyon fills in each played game's count quietly in the
background (and daily), and again after you close a game, and the 360 profile corner's score is
a Gamerscore: like a retail 360 game, each game is worth 1,000 G, earned in step with the share of
its achievements unlocked. The Achievements list (the 360's layout, in the middle of the screen)
shows a total row, then each game with "n of m Achievements" and its score; X switches between
installed games and all games.

## 360 menus

In the 360 theme, menus follow the console closely: a flat green selection on light grey bands
with fine white rules; Achievements on a dark screen with the profile picture and clock in the
header; the Guide with the picture between its title and clock and *Achievements (score G)* at the
top of Games & Apps; and Settings as the console's settings screen: a list on the left (the
categories, then a category's settings; B goes back) and a *Current Setting* panel on the right
with the value and what it does.

## Choosing artwork

A game's options have **Choose artwork**: a grid of everything SteamGridDB has for it (covers,
or backgrounds with LT/RT), and the one you pick becomes the game's picture (over one set by hand
before). Y picks a different SteamGridDB game when the match is wrong. *Find artwork
automatically* still takes SteamGridDB's top pick in one step.

## RetroAchievements

Settings › library › *RetroAchievements* signs in with your RetroAchievements username and the
Web API key from retroachievements.org › Settings (it stays on this computer). Every game you've
played there joins the Achievements list next to your Steam games, with its console and real
RetroAchievements points (Steam games count 1,000 G each, shared among their achievements); the
score adds both. A ROM in your library whose title matches a RetroAchievements game (region tags,
"The" and punctuation aside) gets a *RetroAchievements* row in its options and counts as installed
for the list's installed-only view. Unlocks refresh every few hours and after you close an
emulated game.

## Adjusting a background

*Adjust background* in a game's options (Y) moves and zooms its background to fit the home
screen's tiles: the d-pad or stick picks the part that stays in view, LT/RT zoom, and the feature,
wide and narrow tile shapes update as you go. A saves, Y returns to automatic, B cancels.

## Achievement notifications

When you unlock an achievement, an Xbox 360-style *Achievement unlocked* slides in at the bottom of
the screen, over the game, with your sound pack's achievement sound (a gold one, with the rare
sound, for achievements under 10% of players have). Steam ones appear the moment Steam records
them (through Halcyon's listener inside Steam, so Download controls must be on); RetroAchievements
within a minute while an emulated game runs. It's drawn as a Wayland layer-shell overlay
(`src/main/overlay/toast.py`, needing `python3-gi` and `gir1.2-gtklayershell-0.1`), so it never
takes focus from the game; without those, the desktop's own notification is used. Settings ›
system turns it off or plays a sample.

## Monitor

Settings › display › *Monitor* picks the screen Halcyon fills (and the Guide that opens over
games). Monitors are listed by name (make, model, port, resolution) and remembered by that name,
so rearranging them doesn't matter. If the chosen one is unplugged, Halcyon opens wherever the
desktop puts it and moves back when it returns. *Automatic* leaves it to the desktop.

Wayland doesn't let an app place its own window, so on COSMIC Halcyon asks the compositor
instead (`src/main/cosmicWindows.js`: COSMIC's toplevel-management protocol moves the window to
the output's workspace and fullscreens it there, and its toplevel-info protocol says which screen
the window is really on). On other desktops it falls back to Electron's own window placement.

*Sound follows the monitor* sends the system's sound to a screen's own HDMI / DisplayPort audio
while Halcyon is on it, and puts the previous output back when Halcyon moves to another screen or
closes (unless you changed the output yourself in the meantime). Out of the box it does this for
TVs and receivers only (outputs that report more than plain stereo); tick or untick any monitor in
the setting. The monitor on each output is read from the graphics card (`amixer`'s ELD data), as
PipeWire's own labels for these outputs can name the wrong screen.

## Going back to a game

Leave a game for the dashboard (Guide › *Halcyon Home*) and it keeps running. While it does, the
home screen's top-left tile becomes *Resume <game>*, its tile anywhere says *Resume* instead of
*Play*, and the Guide lists *Resume <game>* (Steam games too). Any of these puts Halcyon aside and
the game back on screen instead of starting it again.

*Quit game* sits in the Guide and in a running game's options (Y on its tile, on home or
anywhere). Games Halcyon started are closed directly. Steam games are closed through Steam's own
Stop when Download controls are on; if Steam can't be asked, or the game is still there a few
seconds later, Halcyon closes the game's processes (found by the `SteamAppId` Steam gives them),
politely first.

*Uninstall* (a Steam game's options, or the storage manager) asks once, in Halcyon, then has
Steam remove the game without its own dialog: Halcyon calls what Steam's dialog calls after you
confirm (`SteamClient.Installs.OpenUninstallWizard`, already confirmed). This needs Download
controls on; without them Steam's own dialog still asks.

*Install* (A on a game you own but haven't installed) asks in Halcyon which Steam library to put
it in, with each one's free space, then has Steam start the download without its dialog or Big
Picture: Halcyon opens Steam's install wizard, picks that folder and continues, as Steam's dialog
would. If the game doesn't fit, it cancels and says how much it needs. A licence agreement, CD key
or password is left to Steam's own dialog. Needs Download controls on; otherwise Steam is asked the
old way.

*Storage* (Settings › system, or the Guide) shows each drive with games on it: free space, how
full it is and what the games take, then that drive's games largest first, with Play and
Uninstall.

*Steam Big Picture* opens from the Guide and from Settings › steam (*Open Big Picture*); the Guide
closes it again. *Game start animation* (Settings › display) turns the Halcyon intro that plays
while a game starts on or off.

## Sections

The tabs are **home, games, tv & movies, music** and **settings**. Settings has two sub-tabs,
*general* and *systems* (emulators and ROM folders); LT/RT switch between them. LB/RB (and left/right on the tabs) wrap round: past settings is home, and before home is settings. The store and
collections pages are switched off: nothing in the tabs, Guide or home screen leads to them.

In the 360 theme the games tab is the console's *My Games* list: every game (installed ones in
colour, the rest greyed out, ready to install), with **Show** (all, favorites, recent, Steam, each
installed, not installed, favorites, recently played; then *Where it's from*, *Controller support* and *More*, each opening its own short list), **Search** and **Sort** buttons. LT/RT step through the
Show choices from the buttons. Several Show filters can be on at once (say *Installed* + *Full controller support*), and the filter is remembered between sessions.

**View** (or Select) switches how games are shown: *Covers* (two rows), *Shelf* (one row of big
covers with the selected game's details under it), *Classic* (the 360's game library: the selected cover big, the rest receding to the right, the categories stacked above with up/down to change them, and "1 of 8 | name | platform game" underneath) or *List*
(a list with cover, platform, last played and hours). The choice is remembered.

## Launch scene

While a game starts, Halcyon plays a short intro, like the studio cards games open with: dawn over a
calm sea, a kingfisher (the halcyon of the name) skimming across and touching the water, the
HALCYON wordmark, then the game's own title card with its art, which holds until the game's window
takes over. Steam's launch steps show under the title. It is drawn live (canvas and inline SVG, no
video files) and follows your accent colour. Settings › display › *Launch scene* switches back to the
plain loading card.

## Steam launches, shaders and Big Picture

Steam games start from the desktop Steam client while Halcyon stays fullscreen behind them. With
download controls on, Halcyon follows Steam's launch steps and shows them on its launch card
(syncing cloud saves, starting, ...). When Steam stops to **process Vulkan shaders**, Halcyon skips it
automatically (Settings › steam › *Skip shader processing*; with that off, the card shows the
progress and **A skips it**). With download controls on, games are started through Steam's own
`RunGame`, which does not bring Steam's window up, and Steam's window is put back in the tray if it
appears during the launch.
*Big Picture for store and installs* switches Steam to Big Picture only when you buy or install a
game, so Steam's own screens work with the controller; games themselves never open it.

- **Home goes to Steam instead of Halcyon?** While Steam is running it takes the controller's
  Home/PS button for itself. Turn off Steam › Settings › Controller › *Guide button focuses
  Steam*. Select + Start (Share + Options) opens the in-game menu either way, and B on the home
  screen opens the Guide.

## The Guide over games

With **Home button opens the Guide** on (Settings › system, on by default), pressing the
controller's Home button while Halcyon is in the background opens the full Guide over whatever is
on screen: any game, Steam's included, or the desktop. Halcyon reads the button straight from the
controller (`/dev/input`), so it works even when the game has the controller. Resume gives the screen
back to the game; anything that belongs to the dashboard (Halcyon Home, a section, launching a game,
search) hands over to it; downloads open right there. Home again or B closes it. **Hold Home for two
seconds** to close a game Halcyon started, for when a game has frozen. Select + Start does the same
as Home on controllers without one.

While Halcyon runs it turns off Steam's own *Guide button focuses Steam* (through Steam's settings,
so **Download controls** must be on) so Steam stays put when you press Home, and turns it back on
when Halcyon quits. Steam's in-game overlay stays on (Steam Input needs it to pass the controller to
Steam games); inside a Steam game Halcyon opens its Guide a moment after Steam's overlay, on top of it.

## Themes

Settings › display › *Theme*: **Halcyon** (dark glass over your game art), **Classic** (a bright
colour wash, glossy square tiles and solid blades, after the mid-2000s console dashboards) and
**Midnight** (pure black and flat), **360 Light** (pale and flat, after the final Xbox 360
dashboard: lowercase pivots, square tiles, a green focus frame, light menus) and **360** (after the
Xbox 360 dashboard as it looked on the console: grey backdrop, white pivots, bright green tiles
that grow when selected, image tiles with a name strip, boxed light menus with a green bar, a
centred Guide between side blades, and button prompts bottom-left). Both 360 themes are always
green; the accent color applies to the others. They use Segoe UI if it is installed and Open Sans
otherwise, and contain no Microsoft artwork, fonts or sounds. Themes live in
`src/renderer/styles/themes.css` as overrides keyed on `body[data-theme]`.

## Sound packs

Settings › display › *Sound pack* switches between Halcyon's built-in tones and packs in
`~/.config/Halcyon/sounds/<pack>/`; *Add a sound pack…* copies a folder there. Packs made for the
Steam Deck sound loader (a `pack.json` with `mappings` from Deck sound names to files) work as
they are. A `halcyon.json` beside it, or a `halcyon` object in `pack.json`, maps Halcyon's own
events directly: `move`, `edge`, `select`, `back`, `sectionLeft`, `sectionRight`, `open`, `guide`,
`toast`, `download`, `error`, `launch`, `boot`, `wake`, `typing`. Events a pack does not cover use
the built-in tones. Packs are levelled as they load: each sound's loudest moment is brought to a set level
for its kind (moving around is quieter than confirming), and silence at the start of a file is
skipped. Sound files stay in your config folder; none ship with Halcyon.

## Controller-only library, installs and artwork

- **Hide games without controller support** (Settings › library). Halcyon asks Steam's public
  store listing which of your installed games support a controller and remembers the answers.
  Games listed with none are hidden; they stay reachable under *Collections › No controller*.
  A game's options menu has *Controller support* to overrule Steam either way.
- **Install emulators** (Systems › pick an emulator › Install). Downloads the latest x86-64
  AppImage from the project's GitHub releases into `~/Applications` and makes it executable, or
  installs the Flathub build for your user when the project publishes no AppImage. Every emulator
  also links to its project page. AppImages need FUSE 2 (`libfuse2`).
- **Artwork from SteamGridDB** (Settings › artwork). Enter a free API key from
  steamgriddb.com › Preferences › API, then *Fetch missing artwork*, or *Find artwork online* on
  a single game. Images are saved under `~/.config/Halcyon/art`. The key is stored in the config
  file, readable only by you. (SteamDB, the stats site, offers no API or keys.)

## What it finds

- **Steam** — native, Flatpak and Snap installs, every library folder, installed games with
  playtime, last-played and the artwork Steam already cached. Launches through the right client
  (`steam://rungameid/…`).
- **Emulators** — RetroArch, Dolphin, Cemu, Ryujinx, PCSX2, DuckStation, RPCS3, PPSSPP, mGBA,
  melonDS, Azahar, Flycast and xemu, whether installed from packages, Flatpak or as an AppImage
  in `~/Applications` / `~/AppImages`.
- **ROMs** — folders named after a platform (`gba`, `wiiu`, `ps2`, …) inside common roots such as
  `~/ROMs`, plus the game folders already configured in Cemu, Ryujinx, Dolphin, PCSX2 and
  DuckStation. Add more under **Systems**. Cover art is picked up from ES-DE's
  `downloaded_media`, or from `covers/` next to the ROMs.
- **Anything else** — *Add a game* takes a name and a command.

Per game you can set a cover and background, rename, hide, favorite and file it into collections.

## Layout

```
src/main/                 Electron main process
  main.js                 window, IPC, media:// artwork protocol
  store.js                JSON persistence (~/.config/Halcyon/config.json)
  library.js              merges sources + user overrides
  launcher.js             process launching, session tracking, failure reporting
  system.js               volume, power, controller batteries, start on login
  padwatch.js             Home button while a game is running
  files.js                directory listing for the file picker
  scraper.js              SteamGridDB artwork
  media/jellyfin.js       Jellyfin sign-in, browsing, playback info, progress reports
  steam/                  VDF parser, install/library/artwork discovery, downloads, download
                          controls (client.js),
                          controller support, storefront, owned games (Web API)
  emulators/              emulator + platform catalog, detection, ROM scanning, installer
src/renderer/
  js/core/                focus engine, gamepad/keyboard input, sounds, state
  js/ui/                  tiles, blade menu, guide, on-screen keyboard, file picker, toasts
  js/views/               home, games, media, store, collections, systems, settings
  js/media/               Jellyfin tiles, details page and the player
  styles/
```

## Testing

```bash
npm run test:ui
```

Drives the real UI with a simulated gamepad, a throwaway config folder and local stand-ins for
GitHub, SteamGridDB, the Steam store and the Steam Web API, so nothing real is downloaded. It checks navigation, dialogs, text entry, launching
and error handling. It runs with `HALCYON_DRY_RUN=1`, which resolves Steam and emulator launch
commands without starting them and never sends power commands to the system. It creates and removes a few temporary library entries.
