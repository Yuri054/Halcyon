#!/usr/bin/env python3
# Halcyon's achievement toast, in the Xbox 360's style: a round badge (black ring with notch
# marks and a green arc around a silver sphere) at the left end of a dark grey pill with two
# lines of text. It slides up from below the bottom edge of the screen to the bottom centre,
# stays, then slides back down.
#
# Drawn as a Wayland layer-shell overlay (the layer the desktop's panel and notifications use),
# so it shows over fullscreen games and never takes focus.
#
#   toast.py '<json>'                       show it: { title, line, icon, rare, x, y, sound, ms }
#   toast.py --render <dir> '<json>' [bg]  write preview frames (PNG) instead, for checking
import json, math, os, subprocess, sys, time
import cairo

PILL_H = 92          # pill height (the badge is a little larger)
BADGE_R = 50         # badge radius
WIDTH = 680          # whole toast width
MARGIN = 70          # distance from the bottom edge when shown
SLIDE = 0.45         # seconds to slide in or out
FONT = 'Open Sans'


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in(t):
    t = max(0.0, min(1.0, t))
    return t ** 3


def pill_path(cr, x, y, w, h):
    r = h / 2
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, math.pi / 2)
    cr.arc(x + r, y + r, r, math.pi / 2, 3 * math.pi / 2)
    cr.close_path()


def draw_trophy(cr, cx, cy, size, color):
    """A simple cup: bowl, handles, stem and base, in the arc's colour with a dark edge."""
    w = size
    cr.save()
    cr.set_line_join(cairo.LINE_JOIN_ROUND)
    # handles (behind the bowl)
    cr.set_line_width(max(1.5, w * 0.13))
    cr.set_source_rgb(*[c * 0.8 for c in color])
    for sgn in (-1, 1):
        cr.new_path()
        cr.arc(cx + sgn * w * 0.52, cy - w * 0.40, w * 0.24, 0, 2 * math.pi)
        cr.stroke()
    cr.new_path()
    cr.move_to(cx - w * 0.55, cy - w * 0.72)
    cr.line_to(cx + w * 0.55, cy - w * 0.72)
    cr.curve_to(cx + w * 0.55, cy - w * 0.05, cx + w * 0.30, cy + w * 0.18, cx + w * 0.11, cy + w * 0.22)
    cr.line_to(cx + w * 0.11, cy + w * 0.46)
    cr.line_to(cx + w * 0.38, cy + w * 0.52)
    cr.line_to(cx + w * 0.38, cy + w * 0.70)
    cr.line_to(cx - w * 0.38, cy + w * 0.70)
    cr.line_to(cx - w * 0.38, cy + w * 0.52)
    cr.line_to(cx - w * 0.11, cy + w * 0.46)
    cr.line_to(cx - w * 0.11, cy + w * 0.22)
    cr.curve_to(cx - w * 0.30, cy + w * 0.18, cx - w * 0.55, cy - w * 0.05, cx - w * 0.55, cy - w * 0.72)
    cr.close_path()
    gr = cairo.LinearGradient(cx - w, 0, cx + w, 0)
    gr.add_color_stop_rgb(0, color[0] * 0.7, color[1] * 0.7, color[2] * 0.7)
    gr.add_color_stop_rgb(0.4, min(1, color[0] * 1.2), min(1, color[1] * 1.2), min(1, color[2] * 1.2))
    gr.add_color_stop_rgb(1, color[0] * 0.55, color[1] * 0.55, color[2] * 0.55)
    cr.set_source(gr)
    cr.fill_preserve()
    cr.set_source_rgba(0.08, 0.12, 0.04, 0.9)
    cr.set_line_width(max(1.2, w * 0.07))
    cr.stroke()
    cr.restore()


def draw_badge(cr, cx, cy, R, rare, icon_surface):
    # Outer black ring with a soft shadow.
    cr.set_source_rgba(0, 0, 0, 0.55)
    cr.arc(cx, cy + 2, R + 3, 0, 2 * math.pi)
    cr.fill()
    cr.set_source_rgb(0.06, 0.06, 0.06)
    cr.arc(cx, cy, R, 0, 2 * math.pi)
    cr.fill()
    ring_in = R * 0.80
    # The arc in the upper-left quarter: green (gold when rare).
    arc = (0.98, 0.76, 0.18) if rare else (0.47, 0.80, 0.16)
    cr.set_source_rgb(*arc)
    cr.set_line_width((R - ring_in) * 0.62)
    cr.new_path()
    cr.arc(cx, cy, (R + ring_in) / 2, math.pi + 0.22, 1.5 * math.pi - 0.22)
    cr.stroke()
    # The four light notch marks (top, right, bottom, left).
    cr.set_source_rgb(0.62, 0.63, 0.64)
    for k in range(4):
        cr.save()
        cr.translate(cx, cy)
        cr.rotate(k * math.pi / 2)
        cr.rectangle(ring_in - 1, -R * 0.07, (R - ring_in) + 1, R * 0.14)
        cr.fill()
        cr.restore()
    # The silver sphere.
    s = ring_in - 2
    g = cairo.RadialGradient(cx - s * 0.35, cy - s * 0.45, s * 0.05, cx, cy, s)
    g.add_color_stop_rgb(0, 0.98, 0.98, 0.98)
    g.add_color_stop_rgb(0.45, 0.78, 0.79, 0.80)
    g.add_color_stop_rgb(1, 0.36, 0.37, 0.38)
    cr.set_source(g)
    cr.arc(cx, cy, s, 0, 2 * math.pi)
    cr.fill()
    cr.save()
    cr.arc(cx, cy, s, 0, 2 * math.pi)
    cr.clip()
    # Like the console, the badge is always the same (the game's own icon isn't shown here).
    draw_trophy(cr, cx, cy + s * 0.06, s * 0.78, arc)
    cr.restore()
    # A glossy highlight over the top of the sphere.
    cr.save()
    hl = cairo.LinearGradient(0, cy - s, 0, cy - s * 0.1)
    hl.add_color_stop_rgba(0, 1, 1, 1, 0.38)
    hl.add_color_stop_rgba(1, 1, 1, 1, 0)
    cr.set_source(hl)
    cr.translate(cx, cy - s * 0.58)
    cr.scale(s * 0.66, s * 0.34)
    cr.arc(0, 0, 1, 0, 2 * math.pi)
    cr.restore()
    cr.fill()


def frame(cr, W, H, t, a, icon_surface, show):
    """Draw the toast at time t (seconds) on a W x H surface whose bottom is the screen edge."""
    cr.set_operator(cairo.OPERATOR_SOURCE)
    cr.set_source_rgba(0, 0, 0, 0)
    cr.paint()
    cr.set_operator(cairo.OPERATOR_OVER)
    # Slide up, stay, slide down.
    if t < SLIDE:
        k = ease_out(t / SLIDE)
    elif t > show - SLIDE:
        k = 1 - ease_in((t - (show - SLIDE)) / SLIDE)
    else:
        k = 1.0
    total = 2 * BADGE_R + 8
    top_shown = H - MARGIN - total
    top = top_shown + (H - top_shown + 6) * (1 - k)
    x0 = (W - WIDTH) / 2
    cy = top + total / 2
    cx = x0 + BADGE_R + 4
    # The pill, from the badge's centre to the right end.
    px, pw, ph = cx, WIDTH - (cx - x0) - 4, PILL_H
    py = cy - ph / 2
    cr.set_source_rgba(0, 0, 0, 0.45)
    pill_path(cr, px - 2, py + 5, pw + 4, ph)
    cr.fill()
    cr.set_source_rgb(0.02, 0.02, 0.02)
    pill_path(cr, px - 3, py - 3, pw + 6, ph + 6)
    cr.fill()
    body = cairo.LinearGradient(0, py, 0, py + ph)
    body.add_color_stop_rgb(0, 0.27, 0.28, 0.29)
    body.add_color_stop_rgb(0.5, 0.21, 0.22, 0.23)
    body.add_color_stop_rgb(1, 0.17, 0.18, 0.19)
    cr.set_source(body)
    pill_path(cr, px, py, pw, ph)
    cr.fill()
    cr.set_source_rgba(0.80, 0.81, 0.82, 0.55)
    cr.set_line_width(1.6)
    pill_path(cr, px + 1.5, py + 1.5, pw - 3, ph - 3)
    cr.stroke()
    # Text: two lines (or one, centred).
    tx = cx + BADGE_R + 16
    room = px + pw - tx - ph / 2
    cr.select_font_face(FONT, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
    cr.set_font_size(29)
    lines = [x for x in [a.get('title', 'Achievement unlocked'), a.get('line', '')] if x]
    ys = [cy - 6, cy + 28] if len(lines) == 2 else [cy + 10]
    for text, y in zip(lines, ys):
        while text and cr.text_extents(text).x_advance > room:
            text = text[:-2].rstrip() + '…'
        cr.set_source_rgba(0, 0, 0, 0.5)
        cr.move_to(tx + 1, y + 1.5)
        cr.show_text(text)
        cr.set_source_rgb(0.93, 0.93, 0.93)
        cr.move_to(tx, y)
        cr.show_text(text)
    draw_badge(cr, cx, cy, BADGE_R, a.get('rare'), icon_surface)


def load_icon(path):
    if not path:
        return None
    try:
        if path.lower().endswith('.png'):
            return cairo.ImageSurface.create_from_png(path)
        import gi
        gi.require_version('GdkPixbuf', '2.0')
        gi.require_version('Gdk', '3.0')
        from gi.repository import GdkPixbuf, Gdk
        pb = GdkPixbuf.Pixbuf.new_from_file(path)
        surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, pb.get_width(), pb.get_height())
        c = cairo.Context(surf)
        Gdk.cairo_set_source_pixbuf(c, pb, 0, 0)
        c.paint()
        return surf
    except Exception:
        return None


def render(out_dir, a, bg=None):
    """Preview frames over a background picture (or plain dark), 1280 x 720 at 30 fps."""
    os.makedirs(out_dir, exist_ok=True)
    W, H = 1280, 720
    show = a.get('ms', 5500) / 1000.0
    icon = load_icon(a.get('icon'))
    back = None
    if bg:
        try:
            back = cairo.ImageSurface.create_from_png(bg)
        except Exception:
            back = None
    fps = 30
    for i in range(int(show * fps) + 1):
        layer = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
        frame(cairo.Context(layer), W, H, i / fps, a, icon, show)
        surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
        cr = cairo.Context(surf)
        if back is not None:
            cr.scale(W / back.get_width(), H / back.get_height())
            cr.set_source_surface(back, 0, 0)
            cr.paint()
            cr.identity_matrix()
        else:
            cr.set_source_rgb(0.08, 0.09, 0.1)
            cr.paint()
        cr.set_source_surface(layer, 0, 0)
        cr.paint()
        surf.write_to_png(os.path.join(out_dir, f'f_{i:04d}.png'))


def show_overlay(a):
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('GtkLayerShell', '0.1')
    from gi.repository import Gtk, Gdk, GLib, GtkLayerShell
    W, H = WIDTH + 40, MARGIN + 2 * BADGE_R + 30
    show = a.get('ms', 5500) / 1000.0
    win = Gtk.Window()
    win.set_app_paintable(True)
    visual = win.get_screen().get_rgba_visual()
    if visual is not None:
        win.set_visual(visual)
    GtkLayerShell.init_for_window(win)
    GtkLayerShell.set_layer(win, GtkLayerShell.Layer.OVERLAY)
    GtkLayerShell.set_keyboard_mode(win, GtkLayerShell.KeyboardMode.NONE)
    GtkLayerShell.set_namespace(win, 'halcyon-toast')
    GtkLayerShell.set_anchor(win, GtkLayerShell.Edge.BOTTOM, True)
    GtkLayerShell.set_margin(win, GtkLayerShell.Edge.BOTTOM, 0)
    GtkLayerShell.set_exclusive_zone(win, -1)
    display = Gdk.Display.get_default()
    for i in range(display.get_n_monitors()):
        m = display.get_monitor(i)
        g = m.get_geometry()
        if abs(g.x - a.get('x', 0)) < 4 and abs(g.y - a.get('y', 0)) < 4:
            GtkLayerShell.set_monitor(win, m)
            break
    icon = load_icon(a.get('icon'))
    start = time.monotonic()
    area = Gtk.DrawingArea()
    area.set_size_request(W, H)
    area.connect('draw', lambda _w, cr: frame(cr, W, H, time.monotonic() - start, a, icon, show) or False)
    win.add(area)
    win.show_all()
    win.input_shape_combine_region(cairo.Region())   # clicks go to the game underneath

    def tick():
        area.queue_draw()
        if time.monotonic() - start > show:
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


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--render':
        render(sys.argv[2], json.loads(sys.argv[3]), sys.argv[4] if len(sys.argv) > 4 else None)
    else:
        show_overlay(json.loads(sys.argv[1]))
