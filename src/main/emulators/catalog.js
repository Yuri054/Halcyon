'use strict';
// Static knowledge about emulators and the platforms they run.
// Launch templates use {rom} and (RetroArch only) {core}.
// `repo` is the GitHub project whose releases the in-app installer downloads from.

const EMULATORS = [
  { id: 'retroarch', repo: 'libretro/RetroArch', name: 'RetroArch', bins: ['retroarch'], flatpak: 'org.libretro.RetroArch', appimage: /retroarch/i, args: ['-f', '-L', '{core}', '{rom}'] },
  { id: 'dolphin', repo: 'dolphin-emu/dolphin', name: 'Dolphin', bins: ['dolphin-emu', 'dolphin-emu-nogui'], flatpak: 'org.DolphinEmu.dolphin-emu', appimage: /dolphin/i, args: ['-b', '-e', '{rom}'] },
  { id: 'cemu', repo: 'cemu-project/Cemu', name: 'Cemu', bins: ['cemu', 'Cemu'], flatpak: 'info.cemu.Cemu', appimage: /cemu/i, args: ['-f', '-g', '{rom}'] },
  { id: 'ryujinx', home: 'https://git.ryujinx.app/ryubing/ryujinx', name: 'Ryujinx', bins: ['ryujinx', 'Ryujinx'], flatpak: 'io.github.ryubing.Ryujinx', appimage: /ryujinx|ryubing/i, args: ['--fullscreen', '{rom}'] },
  { id: 'pcsx2', repo: 'PCSX2/pcsx2', name: 'PCSX2', bins: ['pcsx2-qt', 'pcsx2'], flatpak: 'net.pcsx2.PCSX2', appimage: /pcsx2/i, args: ['-batch', '-fullscreen', '--', '{rom}'] },
  { id: 'duckstation', repo: 'stenzek/duckstation', name: 'DuckStation', bins: ['duckstation-qt', 'duckstation'], flatpak: 'org.duckstation.DuckStation', appimage: /duckstation/i, args: ['-batch', '-fullscreen', '--', '{rom}'] },
  { id: 'rpcs3', repo: 'RPCS3/rpcs3-binaries-linux', name: 'RPCS3', bins: ['rpcs3'], flatpak: 'net.rpcs3.RPCS3', appimage: /rpcs3/i, args: ['--no-gui', '{rom}'] },
  { id: 'ppsspp', repo: 'hrydgard/ppsspp', name: 'PPSSPP', bins: ['PPSSPPSDL', 'ppsspp', 'PPSSPPQt', 'ppsspp-sdl'], flatpak: 'org.ppsspp.PPSSPP', appimage: /ppsspp/i, args: ['--fullscreen', '{rom}'] },
  { id: 'mgba', repo: 'mgba-emu/mgba', name: 'mGBA', bins: ['mgba-qt', 'mgba'], flatpak: 'io.mgba.mGBA', appimage: /mgba/i, args: ['-f', '{rom}'] },
  { id: 'melonds', repo: 'melonDS-emu/melonDS', name: 'melonDS', bins: ['melonDS', 'melonds'], flatpak: 'net.kuribo64.melonDS', appimage: /melonds/i, args: ['-f', '{rom}'] },
  { id: 'azahar', repo: 'azahar-emu/azahar', name: 'Azahar', bins: ['azahar'], flatpak: 'org.azahar_emu.Azahar', appimage: /azahar|lime3ds|citra/i, args: ['{rom}'] },
  { id: 'flycast', repo: 'flyinghead/flycast', name: 'Flycast', bins: ['flycast'], flatpak: 'org.flycast.Flycast', appimage: /flycast/i, args: ['{rom}'] },
  { id: 'xemu', repo: 'xemu-project/xemu', name: 'xemu', bins: ['xemu'], flatpak: 'app.xemu.xemu', appimage: /xemu/i, args: ['-full-screen', '-dvd_path', '{rom}'] },
];

const ARCHIVE = ['zip', '7z'];

const SYSTEMS = [
  { id: 'nes', name: 'Nintendo Entertainment System', short: 'NES', aliases: ['famicom', 'fc', 'fds'], ext: ['nes', 'fds', 'unf', 'unif', ...ARCHIVE], emulators: ['retroarch'], cores: ['mesen', 'nestopia', 'fceumm'] },
  { id: 'snes', name: 'Super Nintendo', short: 'SNES', aliases: ['sfc', 'superfamicom', 'supernintendo'], ext: ['sfc', 'smc', 'swc', 'fig', ...ARCHIVE], emulators: ['retroarch'], cores: ['snes9x', 'bsnes', 'mesen-s'] },
  { id: 'n64', name: 'Nintendo 64', short: 'N64', aliases: ['nintendo64'], ext: ['z64', 'n64', 'v64', ...ARCHIVE], emulators: ['retroarch'], cores: ['mupen64plus_next', 'parallel_n64'] },
  { id: 'gb', name: 'Game Boy', short: 'GB', aliases: ['gameboy'], ext: ['gb', ...ARCHIVE], emulators: ['mgba', 'retroarch'], cores: ['gambatte', 'sameboy', 'mgba'] },
  { id: 'gbc', name: 'Game Boy Color', short: 'GBC', aliases: ['gameboycolor'], ext: ['gbc', 'gb', ...ARCHIVE], emulators: ['mgba', 'retroarch'], cores: ['gambatte', 'sameboy', 'mgba'] },
  { id: 'gba', name: 'Game Boy Advance', short: 'GBA', aliases: ['gameboyadvance'], ext: ['gba', 'agb', ...ARCHIVE], emulators: ['mgba', 'retroarch'], cores: ['mgba', 'vba_next', 'gpsp'] },
  { id: 'nds', name: 'Nintendo DS', short: 'NDS', aliases: ['ds', 'nintendods'], ext: ['nds', 'dsi', ...ARCHIVE], emulators: ['melonds', 'retroarch'], cores: ['melondsds', 'melonds', 'desmume'] },
  { id: '3ds', name: 'Nintendo 3DS', short: '3DS', aliases: ['n3ds', 'nintendo3ds'], ext: ['3ds', 'cci', 'cxi', 'cia', '3dsx', 'z3ds', 'zcci'], emulators: ['azahar'], cores: [] },
  { id: 'gc', name: 'GameCube', short: 'GC', aliases: ['gamecube', 'ngc', 'gcn'], ext: ['iso', 'gcm', 'rvz', 'gcz', 'ciso', 'wia'], emulators: ['dolphin', 'retroarch'], cores: ['dolphin'] },
  { id: 'wii', name: 'Wii', short: 'Wii', aliases: ['nintendowii'], ext: ['iso', 'wbfs', 'rvz', 'gcz', 'ciso', 'wia', 'wad'], emulators: ['dolphin', 'retroarch'], cores: ['dolphin'] },
  { id: 'wiiu', name: 'Wii U', short: 'Wii U', aliases: ['wii-u', 'wii_u', 'cemu'], ext: ['wua', 'wux', 'wud', 'rpx'], emulators: ['cemu'], cores: [] },
  { id: 'switch', name: 'Nintendo Switch', short: 'Switch', aliases: ['nsp', 'xci', 'nx', 'nintendoswitch', 'ns'], ext: ['nsp', 'xci', 'nro', 'nca'], emulators: ['ryujinx'], cores: [] },
  { id: 'psx', name: 'PlayStation', short: 'PS1', aliases: ['ps1', 'playstation', 'psone'], ext: ['cue', 'chd', 'pbp', 'm3u', 'iso', 'ecm'], emulators: ['duckstation', 'retroarch'], cores: ['swanstation', 'mednafen_psx_hw', 'mednafen_psx', 'pcsx_rearmed'] },
  { id: 'ps2', name: 'PlayStation 2', short: 'PS2', aliases: ['playstation2'], ext: ['iso', 'chd', 'cso', 'zso', 'gz'], emulators: ['pcsx2', 'retroarch'], cores: ['pcsx2'] },
  { id: 'ps3', name: 'PlayStation 3', short: 'PS3', aliases: ['playstation3'], ext: ['iso'], special: ['eboot.bin'], emulators: ['rpcs3'], cores: [] },
  { id: 'psp', name: 'PlayStation Portable', short: 'PSP', aliases: ['playstationportable'], ext: ['iso', 'cso', 'pbp', 'chd'], emulators: ['ppsspp', 'retroarch'], cores: ['ppsspp'] },
  { id: 'genesis', name: 'Sega Genesis', short: 'Genesis', aliases: ['megadrive', 'md', 'segagenesis'], ext: ['md', 'gen', 'smd', 'bin', ...ARCHIVE], emulators: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'mastersystem', name: 'Sega Master System', short: 'SMS', aliases: ['sms'], ext: ['sms', ...ARCHIVE], emulators: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'gamegear', name: 'Sega Game Gear', short: 'GG', aliases: ['gg'], ext: ['gg', ...ARCHIVE], emulators: ['retroarch'], cores: ['genesis_plus_gx'] },
  { id: 'saturn', name: 'Sega Saturn', short: 'Saturn', aliases: ['segasaturn'], ext: ['cue', 'chd', 'm3u', 'iso'], emulators: ['retroarch'], cores: ['mednafen_saturn', 'yabasanshiro', 'kronos'] },
  { id: 'dreamcast', name: 'Sega Dreamcast', short: 'DC', aliases: ['dc'], ext: ['gdi', 'cdi', 'chd', 'cue', 'm3u'], emulators: ['flycast', 'retroarch'], cores: ['flycast'] },
  { id: 'xbox', name: 'Xbox', short: 'Xbox', aliases: ['originalxbox', 'ogxbox'], ext: ['iso', 'xiso'], emulators: ['xemu'], cores: [] },
  { id: 'pcengine', name: 'PC Engine / TurboGrafx-16', short: 'PCE', aliases: ['tg16', 'turbografx16', 'pce'], ext: ['pce', 'cue', 'chd', ...ARCHIVE], emulators: ['retroarch'], cores: ['mednafen_pce_fast', 'mednafen_pce'] },
  { id: 'arcade', name: 'Arcade', short: 'Arcade', aliases: ['mame', 'fbneo', 'fba'], ext: [...ARCHIVE, 'chd'], emulators: ['retroarch'], cores: ['fbneo', 'mame', 'mame2003_plus'] },
  { id: 'atari2600', name: 'Atari 2600', short: '2600', aliases: ['a2600', 'atari'], ext: ['a26', 'bin', ...ARCHIVE], emulators: ['retroarch'], cores: ['stella', 'stella2014'] },
];

module.exports = { EMULATORS, SYSTEMS };
