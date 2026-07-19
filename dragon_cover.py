"""
Dragon top cover / clamp for the Ingcool 7" monitor case
========================================================

A decorative "simple dragon" that lies along the TOP edge of the assembled
case and clamps the front bezel to the rear shell (an inverted-U channel
grips the top edge; front claws hook over the bezel face). Print separately,
then slide it down onto the top of the assembled case.

Style goal: a *simple*, low-detail stylised dragon -- a clean body with a row
of spine ridges, a wedge head with two horns, a curled tail, and talon feet
that grip the front. Everything is parametric and sized from case_design.py.

Run:  python3 dragon_cover.py   ->  dragon_cover.step / .stl

Frame (matches case_design): X = width, Y = up, Z = depth (+Z = screen front).
The assembled case top edge sits at Y = y_top, spanning Z in [z_back, +BEZEL_THK].
"""

import math
import cadquery as cq
import case_design as C

# ---- assembled case top-edge geometry (what we clamp onto) ------------------
Y_TOP    = C.y_top                 # +58  top face of the case
Z_FRONT  = C.BEZEL_THK             # +6   bezel front face
Z_BACK   = C.z_back                # -23  shell back face
CASE_DEP = Z_FRONT - Z_BACK        # 29   front-to-back depth at the top
HALF_W   = C.outer_w / 2           # 91.5

# ---- clamp fit parameters ---------------------------------------------------
CLEAR    = 0.4     # fit clearance between cover channel and case (per side)
LIP_T    = 3.0     # front/back lip wall thickness
CAP_T    = 4.0     # thickness of the cap sitting over the top face
LIP_DROP = 9.0     # how far the lips reach down the front & back faces
BODY_HALF = HALF_W - C.CORNER_FIL - 2.0   # body runs +/- this in X (~82)

# ---- dragon styling ---------------------------------------------------------
BODY_R      = (CAP_T + LIP_DROP)   # rough body height for shaping references
HEAD_LEN    = 34.0                 # snout length beyond the +X body end
HEAD_DROP   = 10.0                 # how far the head dips below the top
HORN_LEN    = 16.0
TAIL_LEN    = 46.0                 # tail length beyond the -X body end
TAIL_RISE   = 26.0                 # how high the tail curls up
N_SPINES    = 11                   # spine ridges along the back
SPINE_H     = 9.0                  # tallest spine height
SPINE_T     = 3.0                  # spine thickness (along X)
N_CLAWS     = 4                    # talon feet gripping the front bezel
CLAW_DROP   = 7.0                  # how far talons hang below the front lip

# outer channel extents in Z (lips add LIP_T outside the case faces)
z_out_front = Z_FRONT + LIP_T
z_out_back  = Z_BACK - LIP_T
z_mid       = (z_out_front + z_out_back) / 2
depth_out   = z_out_front - z_out_back


# ============================================================================
def wbox(x0, x1, y0, y1, z0, z1):
    """Axis-aligned box from two world corners (order-independent)."""
    x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1)); z0, z1 = sorted((z0, z1))
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False)\
        .translate((x0, y0, z0))


def build_dragon():
    # world axes: X width, Y up, Z depth
    outer = wbox(-BODY_HALF, BODY_HALF,
                 Y_TOP - LIP_DROP, Y_TOP + CAP_T,
                 z_out_back, z_out_front)
    # channel cavity (open at the bottom): remove case region + clearance
    cav = wbox(-BODY_HALF - 1, BODY_HALF + 1,
               Y_TOP - LIP_DROP - 1, Y_TOP + CLEAR,
               Z_BACK - CLEAR, Z_FRONT + CLEAR)
    body = outer.cut(cav)

    # round the long top edges of the cap for a smoother "spine" body
    try:
        body = body.edges("|X and >Y").fillet(1.6)
    except Exception:
        pass

    # ---- spine ridges along the back (triangular fins, tapering to the tail) ----
    spines = None
    for i in range(N_SPINES):
        f = i / (N_SPINES - 1)                    # 0 at head end .. 1 at tail end
        x = BODY_HALF - 6 - f * (2 * BODY_HALF - 12)
        h = SPINE_H * (1.0 - 0.55 * f)            # shrink toward the tail
        base = 7.0 * (1.0 - 0.4 * f)
        # triangle in the Z-Y plane (points up), extruded thin along X
        fin = (
            cq.Workplane("YZ")
            .polyline([(Y_TOP + CAP_T - 0.5, z_mid - base / 2),
                       (Y_TOP + CAP_T - 0.5, z_mid + base / 2),
                       (Y_TOP + CAP_T - 0.5 + h, z_mid + base * 0.05)])
            .close()
            .extrude(SPINE_T)
            .translate((x - SPINE_T / 2, 0, 0))
        )
        spines = fin if spines is None else spines.union(fin)
    if spines is not None:
        body = body.union(spines)

    # ---- head at the +X end: reared UP above the top face (clears the case) ----
    hx0 = BODY_HALF - 2                         # 80: head joins the body here
    nose_x = HALF_W + HEAD_LEN * 0.6            # nose projects just past the case end
    hw = 8.0                                    # head half-width (Z)
    # side-profile in X-Y: neck rises from the body, snout points up-and-out.
    # The underside stays at/above the top face until it is past the case end,
    # so the head never collides with the case corner.
    snout = (
        cq.Workplane("XY")
        .polyline([(hx0,          Y_TOP + CAP_T),        # crown base (on the body)
                   (nose_x - 8,   Y_TOP + 15),           # top of head
                   (nose_x,       Y_TOP + 9),            # nose tip (up & out)
                   (nose_x - 3,   Y_TOP + 2),            # lower jaw
                   (HALF_W + 1,   Y_TOP + 0.5),          # underside clears case end
                   (hx0,          Y_TOP + 0.5)])         # back to the body top
        .close()
        .extrude(2 * hw)
        .translate((0, 0, z_mid - hw))
    )
    # bevel the two top nose edges so the snout tapers to a ridge (less blocky)
    try:
        snout = snout.edges("|X and >Y").chamfer(2.5)
    except Exception:
        pass
    body = body.union(snout)

    # horns: two cones from the crown, pointing up and back (toward -X)
    horn_dir = cq.Vector(-0.5, 0.87, 0.0)
    for zs in (z_mid - 5, z_mid + 5):
        cone = cq.Solid.makeCone(3.0, 0.4, HORN_LEN,
                                 pnt=cq.Vector(nose_x - 12, Y_TOP + 13, zs),
                                 dir=horn_dir)
        body = body.union(cq.Workplane(obj=cone))

    # simple eyes: shallow spherical dimples on each side of the head
    for zs in (z_mid - hw + 0.4, z_mid + hw - 0.4):
        eye = cq.Workplane("XY").sphere(2.4).translate((nose_x - 9, Y_TOP + 6, zs))
        body = body.cut(eye)

    # ---- curled tail at the -X end: chain of tapering spheres ----
    # Rides on the cap top and curls up/back so it stays above the top face
    # over the case; only past the case end does it swing freely upward.
    tx0 = -BODY_HALF + 1
    N_TAIL = 26
    for i in range(N_TAIL + 1):
        f = i / N_TAIL
        x = tx0 - f * TAIL_LEN
        y = Y_TOP + CAP_T + TAIL_RISE * (1 - math.cos(f * math.pi / 2))
        r = (CAP_T * 1.1) * (1 - 0.8 * f) + 1.0
        ball = cq.Workplane("XY").sphere(r).translate((x, y, z_mid))
        body = body.union(ball)

    # ---- talon feet resting on the front bezel face (grip + decoration) ----
    # Kept in front of the bezel plane (Z >= Z_FRONT + CLEAR) so they don't
    # dig into the bezel; they hang down the front like claws.
    z_claw_in = Z_FRONT + CLEAR + 0.3
    for i in range(N_CLAWS):
        f = (i + 0.5) / N_CLAWS
        x = -BODY_HALF + 12 + f * (2 * BODY_HALF - 24)
        claw = (
            cq.Workplane("YZ")
            .polyline([(Y_TOP - LIP_DROP + 1, z_out_front),
                       (Y_TOP - LIP_DROP + 1, z_claw_in),
                       (Y_TOP - LIP_DROP - CLAW_DROP, z_claw_in)])
            .close()
            .extrude(4.0)
            .translate((x - 2.0, 0, 0))
        )
        body = body.union(claw)

    # ---- safety: subtract the case volume so the cover can never interfere ----
    # The channel already carries CLEAR clearance; this only trims any residual
    # head/tail overhang that would otherwise touch the case (contact is fine
    # for a clamp, and this guarantees a printable, seat-able fit).
    try:
        case = C._shell_body().val().fuse(C.build_front_bezel().val())
        body = body.cut(cq.Workplane(obj=case))
    except Exception as e:
        print("  (warning: safety cut skipped:", e, ")")

    return body


def export(part, name):
    cq.exporters.export(part, f"{name}.step")
    cq.exporters.export(part, f"{name}.stl")
    print(f"  wrote {name}.step / {name}.stl")


if __name__ == "__main__":
    print("Building dragon cover...")
    d = build_dragon()
    bb = d.val().BoundingBox()
    print(f"  bbox X[{bb.xmin:.1f},{bb.xmax:.1f}] "
          f"Y[{bb.ymin:.1f},{bb.ymax:.1f}] Z[{bb.zmin:.1f},{bb.zmax:.1f}]")
    print(f"  volume {d.val().Volume()/1000:.1f} cm^3")
    export(d, "dragon_cover")
    print("Done.")
