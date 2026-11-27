#!/usr/bin/env python3
# Halcyon's achievement toast, drawn as a Wayland layer-shell overlay (the layer the desktop's
# own panel and notifications use), so it shows over fullscreen games and never takes focus.
# One JSON argument: { "title", "line", "icon" (a PNG path or ""), "rare", "x", "y", "w", "h"
# (the monitor, in logical pixels, to pick it), "sound" (a WAV path or ""), "ms" }.
# Looks like the Xbox 360's: a round badge, then a dark pill sliding out with two lines.
import json, math, subprocess, sys, time
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('GtkLayerShell', '0.1')
from gi.repository import Gtk, Gdk, GdkPixbuf, GLib, GtkLayerShell
import cairo

a = json.loads(sys.argv[1])
W, H = 620, 116          # the window (the pill sits inside, with room for its shadow)
R = 46                   # badge radius
SHOW = a.get('ms', 6500) / 1000.0

win = Gtk.Window()
win.set_app_paintable(True)
visual = win.get_screen().get_rgba_visual()
if visual is not None:
    win.set_visual(visual)
win.set_default_size(W, H)

GtkLayerShell.init_for_window(win)
GtkLayerShell.set_layer(win, GtkLayerShell.Layer.OVERLAY)
GtkLayerShell.set_keyboard_mode(win, GtkLayerShell.KeyboardMode.NONE)
GtkLayerShell.set_namespace(win, 'halcyon-toast')
GtkLayerShell.set_anchor(win, GtkLayerShell.Edge.BOTTOM, True)
GtkLayerShell.set_margin(win, GtkLayerShell.Edge.BOTTOM, 90)

# The monitor Halcyon is on (matched by position).
display = Gdk.Display.get_default()
for i in range(display.get_n_monitors()):
    m = display.get_monitor(i)
    g = m.get_geometry()
    if abs(g.x - a.get('x', 0)) < 4 and abs(g.y - a.get('y', 0)) < 4:
        GtkLayerShell.set_monitor(win, m)
        break

icon = None
if a.get('icon'):
    try:
        icon = GdkPixbuf.Pixbuf.new_from_file_at_scale(a['icon'], 2 * R - 18, 2 * R - 18, True)
    except Exception:
        icon = None

start = time.monotonic()

def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3

def rounded(cr, x, y, w, h, r):
    r = min(r, h / 2, w / 2)
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cr.close_path()

def draw(_w, cr):
    t = time.monotonic() - start
    cr.set_operator(cairo.OPERATOR_SOURCE)
    cr.set_source_rgba(0, 0, 0, 0)
    cr.paint()
    cr.set_operator(cairo.OPERATOR_OVER)
    # Timeline: badge pops in (0–0.35 s), pill slides out (0.35–0.8 s), holds, then all fades.
    pop = ease(t / 0.35)
    slide = ease((t - 0.35) / 0.45)
    fade = 1.0 - ease((t - (SHOW - 0.5)) / 0.5)
    alpha = max(0.0, min(1.0, fade)) * min(1.0, t / 0.15)
    cx, cy = 14 + R, H / 2
    full = W - 24
    pw = (2 * R) + (full - 2 * R) * slide
    # Shadow and pill.
    cr.save()
    cr.set_source_rgba(0, 0, 0, 0.35 * alpha)
    rounded(cr, 14, cy - R + 6, pw, 2 * R, R)
    cr.fill()
    grad = cairo.LinearGradient(0, cy - R, 0, cy + R)
    grad.add_color_stop_rgba(0, 0.24, 0.24, 0.25, 0.96 * alpha)
    grad.add_color_stop_rgba(1, 0.09, 0.09, 0.10, 0.96 * alpha)
    cr.set_source(grad)
    rounded(cr, 14, cy - R, pw, 2 * R, R)
    cr.fill()
    cr.restore()
    # Text, revealed as the pill opens.
    if slide > 0.05:
        cr.save()
        rounded(cr, 14, cy - R, pw, 2 * R, R)
        cr.clip()
        cr.select_font_face('Segoe UI', cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
        tx = cx + R + 18
        cr.set_source_rgba(0.75, 0.75, 0.75, alpha * slide)
        cr.set_font_size(20)
        cr.move_to(tx, cy - 6)
        cr.show_text(a.get('title', 'Achievement unlocked'))
        cr.set_source_rgba(1, 1, 1, alpha * slide)
        cr.set_font_size(25)
        cr.move_to(tx, cy + 26)
        line = a.get('line', '')
        while line and cr.text_extents(line).x_advance > full - (tx - 14) - 30:
            line = line[:-2] + '…' if not line.endswith('…') else line[:-2] + '…'
        cr.show_text(line)
        cr.restore()
    # Badge: a bright ring (green, or gold when rare) around the achievement's icon.
    r = R * (0.6 + 0.4 * pop)
    ring = (1.0, 0.78, 0.2) if a.get('rare') else (0.55, 0.85, 0.25)
    cr.set_source_rgba(0, 0, 0, 0.4 * alpha)
    cr.arc(cx, cy + 3, r, 0, 2 * math.pi)
    cr.fill()
    g = cairo.RadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r)
    g.add_color_stop_rgba(0, min(1, ring[0] + 0.25), min(1, ring[1] + 0.15), min(1, ring[2] + 0.2), alpha)
    g.add_color_stop_rgba(1, ring[0] * 0.55, ring[1] * 0.55, ring[2] * 0.4, alpha)
    cr.set_source(g)
    cr.arc(cx, cy, r, 0, 2 * math.pi)
    cr.fill()
    inner = r - 7
    cr.save()
    cr.arc(cx, cy, inner, 0, 2 * math.pi)
    cr.clip()
    if icon is not None:
        s = (2 * inner) / max(icon.get_width(), icon.get_height())
        cr.translate(cx - inner, cy - inner)
        cr.scale(s, s)
        Gdk.cairo_set_source_pixbuf(cr, icon, 0, 0)
        cr.paint_with_alpha(alpha)
    else:
        cr.set_source_rgba(0.1, 0.1, 0.1, alpha)
        cr.paint()
        cr.set_source_rgba(1, 1, 1, alpha)
        cr.select_font_face('Segoe UI', cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        cr.set_font_size(inner * 1.1)
        e = cr.text_extents('G')
        cr.move_to(cx - e.width / 2 - e.x_bearing, cy - e.height / 2 - e.y_bearing)
        cr.show_text('G')
    cr.restore()
    return False

area = Gtk.DrawingArea()
area.set_size_request(W, H)
area.connect('draw', draw)
win.add(area)
if __import__('os').environ.get('HALCYON_TOAST_DEBUG'):
    print('backend', type(display).__name__, 'monitors', [(display.get_monitor(i).get_model(), display.get_monitor(i).get_geometry().x) for i in range(display.get_n_monitors())], 'layer ok', GtkLayerShell.is_supported(), flush=True)
win.show_all()
# The overlay ignores the pointer, so a click goes to the game underneath.
win.input_shape_combine_region(cairo.Region())

def tick():
    area.queue_draw()
    if time.monotonic() - start > SHOW:
        Gtk.main_quit()
        return False
    return True

GLib.timeout_add(16, tick)
if a.get('sound'):
    try:
        subprocess.Popen(['paplay', a['sound']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
Gtk.main()
