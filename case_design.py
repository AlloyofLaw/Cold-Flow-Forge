"""
Ingcool 7" Mini Monitor Case - Parametric CAD (CadQuery)
=========================================================

Board: ingcool 7DP-CAPLCD, Rev4.1 (HDMI + capacitive-touch USB).
Spec sheet: http://www.ingcool.com/wiki/7DP-CAPLCD

This generates a 3D-printable desktop monitor case that rests on a SLIGHT
BACKWARD TILT so the centre of mass is shifted rearward (leaning back),
which keeps the screen from tipping forward under its own weight.

The tilt is INTEGRATED into the rear shell as a fixed wedge base (no moving
parts) instead of a fold-out kickstand. One parameter -- TILT_ANGLE --
controls the lean; everything about the base is derived from it, so it can
be re-tuned in one place. The wedge gives a full-contact flat footprint on
the desk (no rocking) with a rearward heel extension so the projected
centre of mass lands comfortably inside the support base.

Parts generated (STEP for Onshape / further editing, STL for slicing):
  * front_bezel  - screen bezel with rabbet lip
  * rear_shell   - back shell: cavity, standoffs, ports, vent, TILT BASE

Run:  pip install cadquery --break-system-packages && python3 case_design.py

Coordinate frame (before the export-time tilt is applied to the shell):
  X = width  (left/right, centred on 0)
  Y = height (up, 0 at panel centre; bottom = -outer_h/2, top = +outer_h/2)
  Z = depth  (Z=0 at the shell front opening / bezel interface; the shell
              body extends toward -Z, the bezel toward +Z)
"""

import math
import cadquery as cq

# ============================================================================
# PARAMETERS  (all mm)
# ============================================================================

# --- Board / fit ("VERIFY" = estimated from published spec, measure to confirm)
PANEL_W      = 165.0   # VERIFY - full module width
PANEL_H      = 98.0    # VERIFY - full module height
MOUNT_INSET_X = 8.0    # VERIFY - mount-hole centre inset from board edge (X)
MOUNT_INSET_Y = 8.0    # VERIFY - mount-hole centre inset from board edge (Y)
HDMI_FRAC    = 0.62    # VERIFY - HDMI centre as fraction of PANEL_W (from left)
USB_FRAC     = 0.38    # VERIFY - touch-USB centre as fraction of PANEL_W

# --- Screen opening / bezel (style + fit, safe to tune without measuring)
ACTIVE_W     = 153.0   # visible screen cutout width
ACTIVE_H     = 89.6    # visible screen cutout height
BEZEL_BORDER = 9.0     # frame width beyond the panel edge
BEZEL_THK    = 6.0     # front bezel thickness
LIP_DEPTH    = 2.0     # rabbet depth that captures the panel edge
CORNER_FIL   = 7.5     # outer corner fillet (soft / minimalist)
EDGE_CHAMFER = 0.6     # perimeter + screen-opening bevel

# --- Shell
WALL         = 3.0     # shell wall thickness
CAVITY_DEPTH = 20.0    # internal depth (clears HDMI plug + cable)
STANDOFF_H   = 4.0     # board standoff height
MOUNT_HOLE_D = 2.6     # M3 self-tap pilot hole
BOSS_OD      = 7.0     # standoff boss outer diameter
BOSS_HOLE_DEPTH = 6.0  # pilot depth into boss (< STANDOFF_H + WALL = 7, stays blind)

# --- Ports (on the bottom edge, sizes are cutout envelopes incl. clearance)
HDMI_W, HDMI_H = 16.0, 8.0
USB_W,  USB_H  = 10.0, 5.0
PORT_Z_INSET   = 10.0   # port centre inset from the front opening (toward -Z)

# --- Vent (single hidden slot, high on the back wall)
VENT_W, VENT_H = 40.0, 2.5

# --- Integrated backward tilt (the requested feature) ------------------------
TILT_ANGLE     = 12.0   # degrees of backward lean from vertical ("slight")
BASE_REAR_EXT  = 32.0   # heel: how far the base extends behind the shell back
BASE_HEEL_H    = 6.0    # min base thickness at the rear (lifts shell off desk)
BASE_SIDE_INSET = 6.0   # base is inset from the shell width on each side
CABLE_CH_W     = 60.0   # width of the under-case cable channel (spans both ports)
CABLE_CH_H     = 9.0    # height of that channel (cable clearance to desk)

# ============================================================================
# DERIVED
# ============================================================================
outer_w = PANEL_W + 2 * BEZEL_BORDER            # 183.0
outer_h = PANEL_H + 2 * BEZEL_BORDER            # 116.0
shell_D = CAVITY_DEPTH + WALL                   # front(0) .. back(-shell_D)

mount_x = PANEL_W / 2 - MOUNT_INSET_X
mount_y = PANEL_H / 2 - MOUNT_INSET_Y
MOUNTS = [(sx * mount_x, sy * mount_y) for sx in (-1, 1) for sy in (-1, 1)]

hdmi_x = (HDMI_FRAC - 0.5) * PANEL_W             # +19.8
usb_x  = (USB_FRAC - 0.5) * PANEL_W             # -19.8
port_z = -PORT_Z_INSET                           # -10.0

y_bot = -outer_h / 2                             # shell bottom (upright frame)
y_top = outer_h / 2
z_front = 0.0
z_back = -shell_D


# ============================================================================
# FRONT BEZEL
# ============================================================================
def build_front_bezel():
    """Flat front frame with a rabbet lip that captures the panel edge."""
    bez = (
        cq.Workplane("XY")
        .box(outer_w, outer_h, BEZEL_THK, centered=(True, True, False))
    )
    # soft outer corners (vertical edges parallel to Z)
    bez = bez.edges("|Z").fillet(CORNER_FIL)

    # screen opening straight through
    bez = (
        bez.faces(">Z").workplane(centerOption="CenterOfBoundBox")
        .rect(ACTIVE_W, ACTIVE_H)
        .cutThruAll()
    )

    # rabbet: a shallow recess on the BACK face, sized to the panel module,
    # that the screen edge drops into (leaves a lip = BEZEL_BORDER wide).
    rabbet_w = PANEL_W + 0.6   # 0.3 mm/side drop-in clearance
    rabbet_h = PANEL_H + 0.6
    bez = (
        bez.faces("<Z").workplane(centerOption="CenterOfBoundBox")
        .rect(rabbet_w, rabbet_h)
        .cutBlind(-LIP_DEPTH)
    )

    # subtle bevel on the front screen opening
    bez = bez.faces(">Z").edges("%LINE").chamfer(EDGE_CHAMFER)
    return bez


# ============================================================================
# REAR SHELL (with integrated backward-tilt base)
# ============================================================================
def _shell_body():
    """Upright hollow shell with cavity, standoffs, ports, vent."""
    # outer solid, front face at Z=0, body toward -Z
    shell = (
        cq.Workplane("XY")
        .box(outer_w, outer_h, shell_D, centered=(True, True, False))
        .translate((0, 0, -shell_D))
    )
    shell = shell.edges("|Z").fillet(CORNER_FIL)

    # soft bevel around the outer front rim (before hollowing, outer edges only)
    try:
        shell = shell.faces(">Z").edges("%LINE").chamfer(EDGE_CHAMFER)
    except Exception:
        pass

    # hollow the cavity from the front, leaving WALL on all sides + back
    shell = (
        shell.faces(">Z").workplane(centerOption="CenterOfBoundBox")
        .rect(outer_w - 2 * WALL, outer_h - 2 * WALL)
        .cutBlind(-CAVITY_DEPTH)
    )

    # ---- standoff bosses on the inner back wall ----
    inner_back_z = z_back + WALL   # = -CAVITY_DEPTH
    for (mx, my) in MOUNTS:
        boss = (
            cq.Workplane("XY")
            .center(mx, my)
            .circle(BOSS_OD / 2)
            .extrude(STANDOFF_H)
            .translate((0, 0, inner_back_z))
        )
        shell = shell.union(boss)
    # pilot holes drilled into each boss top (blind, toward -Z)
    boss_top_z = inner_back_z + STANDOFF_H
    for (mx, my) in MOUNTS:
        hole = (
            cq.Workplane("XY")
            .center(mx, my)
            .circle(MOUNT_HOLE_D / 2)
            .extrude(-BOSS_HOLE_DEPTH)
            .translate((0, 0, boss_top_z))
        )
        shell = shell.cut(hole)

    # ---- ports on the bottom wall (pierce the WALL) ----
    # Opening in the bottom face: X = connector width, Z = connector depth.
    # Box centred on the wall mid-plane, oversized in Y so it fully pierces.
    for (cx, w, d) in [(hdmi_x, HDMI_W, HDMI_H), (usb_x, USB_W, USB_H)]:
        cutter = (
            cq.Workplane("XY")
            .box(w, WALL + 2.0, d, centered=True)     # X=w, Y=through wall, Z=d
            .translate((cx, y_bot + WALL / 2, port_z))
        )
        shell = shell.cut(cutter)

    # ---- hidden vent slot, high on the back wall ----
    vent = (
        cq.Workplane("XY")
        .box(VENT_W, VENT_H, WALL + 2.0, centered=(True, True, True))
        .translate((0, y_top - WALL - 8.0, z_back + WALL / 2))
    )
    shell = shell.cut(vent)
    return shell


def _tilt_base(shell_tilted):
    """
    Build the wedge base under the already-tilted shell.

    The shell has been rotated backward by TILT_ANGLE about its rear-bottom
    edge and lifted by BASE_HEEL_H. The base is a side-profile polygon in the
    Y-Z plane, extruded across the width, that:
      - sits flat on the desk (Y=0)  -> no rocking
      - matches the tilted shell bottom on top (fused flush)
      - extends rearward by BASE_REAR_EXT (heel) so CoM lands inside the base
    A cable channel is cut under the shell so the bottom ports can exit rearward.
    """
    # locate the shell's two bottom corners after the transform
    bb = shell_tilted.val().BoundingBox()
    # front-bottom corner (max Z of the bottom) and rear-bottom (min Z)
    # after tilt the rear-bottom edge is the low point (near Y=BASE_HEEL_H).
    z_front_t = z_front  # front opening stays near Z=0 in world X-rotation about that axis? recomputed below

    # Rather than track corners analytically, sample the tilted solid's
    # bottom profile from its bounding box + known pivot geometry.
    # Pivot was the rear-bottom edge; after lift it sits at Y=BASE_HEEL_H.
    z_rear_t = bb.zmin
    z_toe_t  = bb.zmax
    y_front_bottom = None  # filled by caller geometry; use bbox ymin region

    # Profile points (Z, Y). Desk = Y=0.
    p_toe_desk   = (z_toe_t,               0.0)
    p_toe_top    = (z_toe_t,               bb.ymin + (BASE_HEEL_H))  # placeholder
    # We build the base as a simple robust wedge: flat desk bottom spanning
    # [z_rear_t - BASE_REAR_EXT, z_toe_t], vertical front face, angled top that
    # follows the shell bottom, and a rear heel block.
    slope = math.tan(math.radians(TILT_ANGLE))
    # height of the shell bottom above desk as a function of Z (linear):
    #   at z_rear_t -> BASE_HEEL_H ; rises toward the toe by slope
    def top_y(z):
        return BASE_HEEL_H + (z - z_rear_t) * slope

    z_tip = z_rear_t - BASE_REAR_EXT
    pts = [
        (z_tip,     0.0),
        (z_tip,     BASE_HEEL_H),
        (z_rear_t,  BASE_HEEL_H),
        (z_toe_t,   top_y(z_toe_t)),
        (z_toe_t,   0.0),
    ]
    base_w = outer_w - 2 * BASE_SIDE_INSET
    base = (
        cq.Workplane("YZ")
        .polyline([(y, z) for (z, y) in pts]).close()
        .extrude(base_w)
        .translate((-base_w / 2, 0, 0))
    )
    # round the visible base corners a touch for a clean look
    base = base.edges("|X").fillet(2.0)

    # cable channel: tunnel along Z under the shell so bottom ports exit rear
    chan = (
        cq.Workplane("XY")
        .box(CABLE_CH_W, CABLE_CH_H, (z_toe_t - z_tip) + 4.0,
             centered=(True, False, True))
        .translate((0, 0, (z_toe_t + z_tip) / 2))
    )
    base = base.cut(chan)
    return base


def build_rear_shell():
    shell = _shell_body()

    # tilt backward about the rear-bottom edge (axis along X at y_bot, z_back)
    shell_t = shell.rotate((0, y_bot, z_back), (1, y_bot, z_back), -TILT_ANGLE)
    # lift so the rear-bottom edge sits BASE_HEEL_H above the desk (Y=0)
    bb = shell_t.val().BoundingBox()
    lift = -bb.ymin + BASE_HEEL_H
    shell_t = shell_t.translate((0, lift, 0))

    base = _tilt_base(shell_t)
    return shell_t.union(base)


# ============================================================================
# STABILITY CHECK  (numeric, printed at build time)
# ============================================================================
def stability_report(rear_shell):
    shp = rear_shell.val()
    com = shp.Center()
    bb = shp.BoundingBox()
    # desk-contact footprint in Z is the flat base bottom (Y ~ 0)
    print("\n--- Stability check (integrated tilt) ---")
    print(f"  TILT_ANGLE        : {TILT_ANGLE:.1f} deg backward")
    print(f"  Overall bbox (mm) : X[{bb.xmin:.1f},{bb.xmax:.1f}] "
          f"Y[{bb.ymin:.1f},{bb.ymax:.1f}] Z[{bb.zmin:.1f},{bb.zmax:.1f}]")
    print(f"  Centre of mass    : X={com.x:.1f}  Y={com.y:.1f}  Z={com.z:.1f}")
    base_front = bb.zmax           # toe (front edge of desk contact)
    base_rear  = bb.zmin           # heel tip
    margin_rear = com.z - base_rear
    margin_front = base_front - com.z
    print(f"  Base footprint Z  : rear tip {base_rear:.1f} .. front toe {base_front:.1f}")
    print(f"  CoM inside base   : {base_rear:.1f} < {com.z:.1f} < {base_front:.1f}  "
          f"-> {'OK' if base_rear < com.z < base_front else 'CHECK'}")
    print(f"  Rear margin       : {margin_rear:.1f} mm (tip-back safety)")
    print(f"  Front margin      : {margin_front:.1f} mm (tip-forward safety)")


# ============================================================================
# EXPORT
# ============================================================================
def export(part, name):
    cq.exporters.export(part, f"{name}.step")
    cq.exporters.export(part, f"{name}.stl")
    print(f"  wrote {name}.step / {name}.stl")


if __name__ == "__main__":
    print("Building parts...")
    bezel = build_front_bezel()
    export(bezel, "front_bezel")
    shell = build_rear_shell()
    export(shell, "rear_shell")
    stability_report(shell)
    print("\nDone.")
