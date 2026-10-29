# =============================================================
# blender-crew.py · 新返航录 15 席写实船员行走图
# -------------------------------------------------------------
# 15 套连体宇航服 / 飞行服角色，Cycles 正交渲染，输出 96×160 帧，
# 4×5 sheet：行 0 下 / 1 上 / 2 待机 / 3 左 / 4 右，列 4 帧。
# 角色朝向约定：模型面朝 -Y；root 绕 Z 旋转得到四个方向。
# 相机俯角 12°，与 v4 船体底图一致；透明背景，游戏内叠加。
#
# 用法：
#   blender -b -P tools/blender-crew.py -- [--test] [--seats 1,2]
#   然后：python tools/crew-sheets.py  （拼 sheet；--test 只拼 1 号）
# =============================================================
import bpy, math, os, sys, json, colorsys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEST = '--test' in ARGS
SEATS_ARG = None
if '--seats' in ARGS:
    i = ARGS.index('--seats')
    if i + 1 < len(ARGS):
        SEATS_ARG = [int(x) for x in ARGS[i + 1].split(',') if x.strip()]

OUT = os.path.join(ROOT, 'tools', '_crew_raw')
os.makedirs(OUT, exist_ok=True)

RESX, RESY = 192, 320
CAM_TILT = math.radians(12.0)
CAM_SCALE = 2.62
CAM_CZ = 1.23


# ---------------- 颜色 ----------------
def srgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def lin(c):
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


def mix(a, b, k):
    return tuple(a[i] * (1 - k) + b[i] * k for i in range(3))


# ---------------- 场景 ----------------
def clear_char():
    for ob in list(bpy.data.objects):
        if ob.type in {'MESH', 'EMPTY', 'CURVE'} and ob.name != 'Camera':
            bpy.data.objects.remove(ob, do_unlink=True)


def setup_scene():
    for ob in list(bpy.data.objects):
        if ob.name not in {'Camera', 'Key', 'Fill', 'Rim', 'Bounce'}:
            bpy.data.objects.remove(ob, do_unlink=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 5
    sc.cycles.transparent_max_bounces = 6
    sc.render.film_transparent = True
    sc.render.resolution_x = RESX
    sc.render.resolution_y = RESY
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.compression = 70
    sc.render.use_persistent_data = True
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    sc.view_settings.exposure = 0.75

    # 世界：冷色微光，透明背景下只提供环境反射
    w = bpy.data.worlds.new('W') if not bpy.data.worlds else bpy.data.worlds[0]
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.045, 0.06, 0.09, 1)
    bg.inputs['Strength'].default_value = 0.55

    # 相机：正交，俯角 12°
    cam = bpy.data.cameras.get('CrewCam') or bpy.data.cameras.new('CrewCam')
    cam.type = 'ORTHO'
    cam.ortho_scale = CAM_SCALE
    co = bpy.data.objects.get('Camera')
    if not co:
        co = bpy.data.objects.new('Camera', cam)
        bpy.context.scene.collection.objects.link(co)
    co.data = cam
    d = 8.0
    co.location = (0, -d, CAM_CZ + d * math.tan(CAM_TILT))
    co.rotation_euler = (math.radians(90) - CAM_TILT, 0, 0)
    sc.camera = co

    # 三点灯：暖主光 / 冷补光 / 青色轮廓
    def area(name, loc, energy, size, color):
        ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'AREA')
        ld.energy = energy
        ld.shape = 'DISK'
        ld.size = size
        ld.color = color
        ob = bpy.data.objects.get(name)
        if not ob:
            ob = bpy.data.objects.new(name, ld)
            bpy.context.scene.collection.objects.link(ob)
        ob.data = ld
        ob.location = loc
        # 朝向原点上方
        target = Vector((0, 0, 1.1))
        ob.rotation_euler = (Vector(loc) - target).to_track_quat('Z', 'Y').to_euler()
        return ob

    area('Key', (2.6, -3.2, 4.4), 520, 3.2, (1.0, 0.93, 0.82))
    area('Fill', (-3.2, -2.2, 2.2), 210, 3.6, (0.72, 0.84, 1.0))
    area('Rim', (-0.8, 3.4, 3.6), 420, 2.6, (0.55, 0.9, 1.0))
    area('Bounce', (0.6, -1.2, 0.05), 60, 2.0, (0.9, 0.8, 0.65))


# ---------------- 材质 ----------------
class Mats:
    def __init__(self, accent_hex, seat):
        self.seat = seat
        ah = srgb(accent_hex)
        h, sa, v = colorsys.rgb_to_hsv(*ah)
        plate = colorsys.hsv_to_rgb(h, min(1, sa * 1.12 + 0.08), v * 0.86)
        self.accent = lin(plate)
        self.suit = lin(srgb('#8D9092'))
        self.under_c = lin(srgb('#303640'))
        self.accent_d = lin(tuple(c * 0.55 for c in plate))
        self.rubber_c = lin(srgb('#1A1E24'))
        self.metal = lin(srgb('#77808C'))
        self.darkmetal = lin(srgb('#3A424D'))
        self.trim = lin(srgb('#D8D3C6'))
        self.visor_c = lin(srgb('#071019'))
        self.glass_c = lin(srgb('#BFE6F0'))
        self._cache = {}

    def m(self, name, base, metallic=0.0, rough=0.55, emit=None, emit_str=0.0,
          alpha=1.0, transmission=0.0, ior=1.45, sheen=0.0, ss=0.0):
        key = (name, tuple(round(x, 4) for x in base), metallic, rough, emit,
               emit_str, alpha, transmission, ior)
        if key in self._cache:
            return self._cache[key]
        mat = bpy.data.materials.new('s%02d_%s' % (self.seat, name))
        mat.use_nodes = True
        b = mat.node_tree.nodes.get('Principled BSDF')

        def s(names, v):
            for n in names:
                if n in b.inputs:
                    try:
                        b.inputs[n].default_value = v
                        return
                    except Exception:
                        pass
        s(['Base Color'], (*base, 1))
        s(['Metallic'], metallic)
        s(['Roughness'], rough)
        s(['Alpha'], alpha)
        s(['IOR'], ior)
        s(['Transmission Weight', 'Transmission'], transmission)
        s(['Sheen Weight', 'Sheen'], sheen)
        s(['Subsurface Weight', 'Subsurface'], ss)
        if ss:
            s(['Subsurface Radius'], (0.04, 0.02, 0.012))
        if emit:
            s(['Emission Color', 'Emission'], (*emit, 1))
            s(['Emission Strength'], emit_str)
        if alpha < 1:
            try:
                mat.blend_method = 'BLEND'
            except Exception:
                pass
        self._cache[key] = mat
        return mat

    def _weave(self, mat, scale, strength):
        nt = mat.node_tree
        b = nt.nodes.get('Principled BSDF')
        if not b or b.inputs.get('Normal').is_linked:
            return mat
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = scale
        tex.inputs['Detail'].default_value = 3.0
        tex.inputs['Roughness'].default_value = 0.6
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = strength
        bump.inputs['Distance'].default_value = 0.02
        nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
        return mat

    def fabric(self):
        return self._weave(self.m('fabric', self.suit, 0.03, 0.74, sheen=0.45), 160, 0.14)

    def under(self):
        return self._weave(self.m('under', self.under_c, 0.05, 0.82, sheen=0.2), 220, 0.10)

    def plate(self):
        return self.m('plate', self.accent, 0.18, 0.38, sheen=0.15)

    def plate_dark(self):
        return self.m('plated', self.accent_d, 0.25, 0.42)

    def rubber(self):
        return self.m('rubber', self.rubber_c, 0.05, 0.86)

    def steel(self):
        return self.m('steel', self.metal, 0.82, 0.32)

    def gunmetal(self):
        return self.m('gunmetal', self.darkmetal, 0.7, 0.4)

    def white(self):
        return self.m('trim', self.trim, 0.18, 0.45)

    def skin(self, hexcol):
        return self.m('skin', lin(srgb(hexcol)), 0.0, 0.62, ss=0.12)

    def hair(self, hexcol):
        return self.m('hair', lin(srgb(hexcol)), 0.0, 0.72)

    def eye(self):
        return self.m('eye', lin(srgb('#120E0B')), 0.0, 0.25)

    def visor(self):
        return self.m('visor', self.visor_c, 0.9, 0.08, ior=1.5)

    def glass(self):
        return self.m('glass', self.glass_c, 0.0, 0.06, alpha=1.0, transmission=1.0, ior=1.45)

    def glow(self, color=None, strength=5.0):
        c = tuple(color) if color else tuple(min(1, x * 1.1 + 0.18) for x in self.accent)
        return self.m('glow', c, 0.0, 0.3, emit=c, emit_str=strength)


# ---------------- 几何工具 ----------------
def _finish(ob, mat, smooth=True, bevel=0.0):
    if mat:
        ob.data.materials.append(mat)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    if bevel > 0:
        md = ob.modifiers.new('bev', 'BEVEL')
        md.width = bevel
        md.segments = 3
        try:
            md.limit_method = 'ANGLE'
            md.angle_limit = math.radians(40)
        except Exception:
            pass
    return ob


def sphere(name, loc, scale, mat, seg=24, ring=16, smooth=True):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1.0, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, mat, smooth)


def capsule(name, a, b, r, mat, taper=0.85, seg=20):
    """两端球化的胶囊，用于四肢/躯干。"""
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2
    d = b - a
    ob = sphere(name, mid, (r, r, d.length / 2 + r * 0.35), mat, seg, 14)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    ob.scale = (1, 1, 1)
    if taper != 1.0:
        # 用简单缩放做上粗下细
        ob.scale = (taper, taper, 1)
    bpy.context.view_layer.update()
    return ob


def box(name, loc, size, mat, bevel=0.012, rot=(0, 0, 0), smooth=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, mat, smooth, bevel)


def cyl(name, loc, r, depth, mat, rot=(0, 0, 0), verts=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth,
                                        location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    return _finish(ob, mat, True, 0.006)


def cone(name, loc, r1, depth, mat, rot=(0, 0, 0), r2=0.0, verts=14):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth,
                                    location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    return _finish(ob, mat, True)


def torus(name, loc, major, minor, mat, rot=(0, 0, 0), maj_seg=24, min_seg=8):
    bpy.ops.mesh.primitive_torus_add(location=loc, rotation=rot, major_radius=major,
                                     minor_radius=minor, major_segments=maj_seg,
                                     minor_segments=min_seg)
    ob = bpy.context.object
    ob.name = name
    return _finish(ob, mat, True)


def tube(name, pts, r, mat):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        bp = sp.bezier_points[i]
        bp.co = Vector(p)
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.empty_display_size = 0.05
    e.location = loc
    if parent:
        e.parent = parent
        bpy.context.view_layer.update()
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    return e


def attach(ob, parent):
    bpy.context.view_layer.update()
    ob.parent = parent
    ob.matrix_parent_inverse = parent.matrix_world.inverted()


# ---------------- 角色 ----------------
HEAD_STYLES = {
    1: 'bare', 2: 'antenna', 3: 'cap', 4: 'headset', 5: 'crest',
    6: 'helmet', 7: 'bun', 8: 'spike', 9: 'halo', 10: 'visor-strip',
    11: 'horn', 12: 'topknot', 13: 'sidegear', 14: 'wing', 15: 'dome',
}
PACKS = {
    1: 'flat', 2: 'tall', 3: 'round', 4: 'twin', 5: 'none', 6: 'flat',
    7: 'tall', 8: 'round', 9: 'twin', 10: 'none', 11: 'flat', 12: 'tall',
    13: 'round', 14: 'twin', 15: 'none',
}
SKINS = ['#D8A273', '#C08A5C', '#A96F44', '#86522F', '#664026', '#D6A176',
         '#C98E62', '#A66B44', '#F3D6B8', '#7A4C30', '#DDA87C', '#B57B52',
         '#E7C39B', '#94603C', '#F1CFAD']
HAIRS = ['#161210', '#2E2118', '#4A3020', '#1C1A18', '#6B5B4A', '#3A2A20',
         '#14100E', '#553524', '#24201C', '#6E4A2A', '#3D2B1E', '#1A1512',
         '#4A3426', '#26211C', '#58402C']


def build(cfg):
    seat = cfg['seat']
    M = Mats(cfg['color'], seat)
    style = HEAD_STYLES.get(seat, 'bare')
    pack = PACKS.get(seat, 'flat')
    skin = M.skin(SKINS[(seat - 1) % len(SKINS)])
    hair = M.hair(HAIRS[(seat - 1) % len(HAIRS)])

    # 根 / 骨架空物体
    root = empty('root', (0, 0, 0))
    hips = empty('hips', (0, 0, 0.95), root)
    spine = empty('spine', (0, 0, 1.02), hips)
    headg = empty('headg', (0, 0, 1.56), spine)
    shL = empty('shL', (0.255, 0, 1.45), spine)
    shR = empty('shR', (-0.255, 0, 1.45), spine)
    elL = empty('elL', (0.295, 0, 1.20), shL)
    elR = empty('elR', (-0.295, 0, 1.20), shR)
    hiL = empty('hiL', (0.105, 0, 0.90), hips)
    hiR = empty('hiR', (-0.105, 0, 0.90), hips)
    knL = empty('knL', (0.110, 0, 0.47), hiL)
    knR = empty('knR', (-0.110, 0, 0.47), hiR)
    bpy.context.view_layer.update()

    C = []  # (object, parent)

    def add(o, parent):
        C.append((o, parent))
        return o

    # ---- 躯干 ----
    add(sphere('pelvis', (0, 0, 0.92), (0.185, 0.13, 0.135), M.fabric()), hips)
    add(sphere('waist', (0, 0, 1.08), (0.185, 0.132, 0.155), M.under()), spine)
    add(sphere('chest', (0, -0.005, 1.32), (0.245, 0.15, 0.25), M.fabric()), spine)
    add(sphere('collar', (0, 0, 1.50), (0.135, 0.115, 0.06), M.gunmetal()), spine)
    add(torus('collar_ring', (0, 0, 1.525), 0.095, 0.02, M.plate(), (0, 0, 0)), spine)
    # 胸甲 / 腹部装甲 / 腰带
    add(box('chest_plate', (0, -0.125, 1.33), (0.30, 0.07, 0.26), M.plate(), 0.035), spine)
    add(box('chest_inset', (0, -0.163, 1.35), (0.17, 0.02, 0.15), M.gunmetal(), 0.02), spine)
    add(cyl('chest_light', (0.075, -0.178, 1.39), 0.028, 0.012, M.glow((1.0, 0.75, 0.35), 4.0),
            (math.radians(90), 0, 0)), spine)
    add(box('ab_plate1', (0, -0.118, 1.16), (0.25, 0.05, 0.09), M.plate_dark(), 0.025), spine)
    add(box('ab_plate2', (0, -0.112, 1.05), (0.23, 0.05, 0.08), M.plate_dark(), 0.022), spine)
    add(torus('belt', (0, 0, 1.00), 0.178, 0.03, M.under(), (0, 0, 0)), hips)
    add(box('buckle', (0, -0.128, 1.00), (0.075, 0.035, 0.06), M.steel(), 0.012), hips)
    add(box('pouchL', (0.155, -0.03, 0.98), (0.07, 0.075, 0.10), M.rubber(), 0.018,
            (0, 0, 0.15)), hips)
    add(box('pouchR', (-0.155, -0.03, 0.98), (0.07, 0.075, 0.10), M.rubber(), 0.018,
            (0, 0, -0.15)), hips)
    # 肩带
    for s in (-1, 1):
        add(box('strap%d' % s, (s * 0.105, -0.15, 1.34), (0.07, 0.035, 0.30),
                M.under(), 0.012, (0, s * 0.10, 0)), spine)
        add(box('strapb%d' % s, (s * 0.105, 0.145, 1.30), (0.07, 0.035, 0.26),
                M.under(), 0.012), spine)

    # ---- 背包 ----
    if pack != 'none':
        if pack == 'round':
            add(sphere('pack', (0, 0.195, 1.27), (0.15, 0.10, 0.20), M.gunmetal()), spine)
            add(torus('pack_ring', (0, 0.255, 1.27), 0.075, 0.014, M.plate(),
                      (math.radians(90), 0, 0)), spine)
        elif pack == 'twin':
            for s in (-1, 1):
                add(cyl('tank%d' % s, (s * 0.075, 0.215, 1.27), 0.058, 0.34, M.steel(),
                        (0, math.radians(90), 0)), spine)
                add(sphere('tankcap%d' % s, (s * 0.075, 0.215, 1.445), (0.058, 0.058, 0.035),
                           M.plate()), spine)
        else:
            h = 0.34 if pack == 'flat' else 0.46
            add(box('pack', (0, 0.20, 1.24), (0.30, 0.13, h), M.gunmetal(), 0.04), spine)
            add(box('pack_panel', (0, 0.268, 1.26), (0.20, 0.02, h * 0.62), M.plate(), 0.018), spine)
            if pack == 'tall':
                add(cyl('pack_ant', (-0.09, 0.23, 1.55), 0.008, 0.22, M.steel()), spine)
                add(sphere('pack_tip', (-0.09, 0.23, 1.67), (0.02, 0.02, 0.02),
                           M.glow((1.0, 0.3, 0.25), 5.0)), spine)
        # 背包到脖子的软管
        add(tube('hose', [(0.14, 0.20, 1.42), (0.18, 0.10, 1.50), (0.11, 0.02, 1.52)],
                 0.014, M.rubber()), spine)

    # ---- 手臂 ----
    for side, sh, el in ((1, shL, elL), (-1, shR, elR)):
        add(box('pads%d' % side, (side * 0.245, -0.005, 1.448), (0.165, 0.20, 0.065),
                M.plate(), 0.026, (0, side * 0.16, side * 0.06)), sh)
        add(capsule('uparm%d' % side, (side * 0.265, 0, 1.43), (side * 0.295, 0, 1.21),
                    0.069, M.fabric()), sh)
        add(torus('armband%d' % side, (side * 0.285, 0, 1.30), 0.063, 0.014, M.plate(),
                  (0, math.radians(90), 0)), sh)
        add(capsule('forearm%d' % side, (side * 0.295, 0, 1.23), (side * 0.315, 0, 1.02),
                    0.058, M.under()), el)
        add(cyl('wrist%d' % side, (side * 0.315, 0, 1.015), 0.056, 0.035, M.plate(),
                (0, math.radians(90), 0)), el)
        add(sphere('glove%d' % side, (side * 0.318, -0.012, 0.955), (0.055, 0.07, 0.075),
                   M.rubber()), el)
        add(box('knuckle%d' % side, (side * 0.318, -0.065, 0.96), (0.075, 0.03, 0.055),
                M.gunmetal(), 0.012), el)

    # ---- 腿 ----
    for side, hi, kn in ((1, hiL, knL), (-1, hiR, knR)):
        add(capsule('thigh%d' % side, (side * 0.105, 0, 0.88), (side * 0.11, 0, 0.50),
                    0.091, M.fabric()), hi)
        add(torus('thighband%d' % side, (side * 0.108, 0, 0.66), 0.084, 0.016, M.plate(),
                  (0, 0, 0)), hi)
        add(box('thighstripe%d' % side, (side * 0.18, -0.01, 0.72), (0.012, 0.05, 0.24),
                M.plate(), 0.004), hi)
        add(box('thighpouch%d' % side, (side * 0.185, -0.02, 0.68), (0.06, 0.08, 0.11),
                M.rubber(), 0.016), hi)
        add(box('knee%d' % side, (side * 0.11, -0.055, 0.47), (0.115, 0.075, 0.13),
                M.plate(), 0.028, (0, 0, 0)), kn)
        add(torus('shinband%d' % side, (side * 0.11, 0, 0.30), 0.070, 0.014, M.plate(),
                  (0, 0, 0)), kn)
        add(capsule('shin%d' % side, (side * 0.11, 0, 0.45), (side * 0.11, 0, 0.13),
                    0.075, M.fabric()), kn)
        add(box('shinguard%d' % side, (side * 0.11, -0.055, 0.30), (0.115, 0.045, 0.26),
                M.under(), 0.02), kn)
        add(box('boot%d' % side, (side * 0.11, -0.045, 0.065), (0.15, 0.26, 0.135),
                M.rubber(), 0.032), kn)
        add(box('sole%d' % side, (side * 0.11, -0.05, 0.012), (0.145, 0.26, 0.025),
                M.gunmetal(), 0.008), kn)
        add(box('bootcap%d' % side, (side * 0.11, -0.145, 0.075), (0.12, 0.06, 0.09),
                M.plate_dark(), 0.02), kn)

    # ---- 头 ----
    add(cyl('neck', (0, 0, 1.55), 0.048, 0.11, skin), headg)
    add(sphere('head', (0, -0.005, 1.70), (0.105, 0.10, 0.125), skin), headg)
    add(sphere('jaw', (0, -0.028, 1.635), (0.083, 0.08, 0.07), skin), headg)
    add(sphere('nose', (0, -0.103, 1.685), (0.018, 0.030, 0.024), skin), headg)
    for s in (-1, 1):
        add(sphere('ear%d' % s, (s * 0.104, 0.0, 1.695), (0.018, 0.028, 0.038), skin), headg)
        add(sphere('eye%d' % s, (s * 0.037, -0.094, 1.715), (0.015, 0.009, 0.013), M.eye()), headg)
        add(box('brow%d' % s, (s * 0.038, -0.097, 1.739), (0.042, 0.014, 0.012), hair, 0.003,
                (0, 0, s * 0.08)), headg)
    add(box('mouth', (0, -0.099, 1.645), (0.038, 0.008, 0.008), M.m('lip', lin(srgb('#7E4A45')), 0, 0.5), 0.002), headg)

    hair_mat = hair
    accent_glow = M.glow(None, 4.0)

    def cap_hair():
        add(sphere('hairtop', (0, 0.012, 1.762), (0.112, 0.112, 0.078), hair_mat), headg)
        add(sphere('hairline', (0, -0.070, 1.782), (0.100, 0.045, 0.038), hair_mat), headg)
        add(sphere('hairback', (0, 0.055, 1.705), (0.102, 0.070, 0.10), hair_mat), headg)
        add(sphere('hairsideL', (0.095, -0.012, 1.66), (0.022, 0.035, 0.055), hair_mat), headg)
        add(sphere('hairsideR', (-0.095, -0.012, 1.66), (0.022, 0.035, 0.055), hair_mat), headg)

    if style == 'bare':
        cap_hair()
    elif style == 'bun':
        cap_hair()
        add(sphere('bun', (0, 0.085, 1.795), (0.058, 0.055, 0.058), hair_mat), headg)
    elif style == 'topknot':
        cap_hair()
        add(sphere('topknot', (0, 0.005, 1.845), (0.045, 0.045, 0.05), hair_mat), headg)
        add(torus('knotband', (0, 0.005, 1.805), 0.038, 0.008, M.plate(),
                  (0, 0, 0)), headg)
    elif style == 'crest':
        cap_hair()
        for i, y in enumerate((-0.075, -0.035, 0.005, 0.045, 0.082)):
            h = 0.055 + 0.035 * math.cos((i - 2) * 0.55)
            add(sphere('crest%d' % i, (0, y, 1.80 + h * 0.35), (0.020, 0.030, h),
                       hair_mat), headg)
    elif style == 'spike':
        cap_hair()
        for i, (x, y) in enumerate(((0, -0.06), (0.06, 0.0), (-0.06, 0.02), (0, 0.06))):
            add(cone('spike%d' % i, (x, y, 1.83), 0.03, 0.09, hair_mat,
                     (math.radians(12) * (1 if y > 0 else -1), 0, 0)), headg)
    elif style == 'cap':
        cap_hair()
        add(sphere('capdome', (0, 0.0, 1.775), (0.118, 0.118, 0.082), M.plate()), headg)
        add(box('capbrim', (0, -0.115, 1.744), (0.19, 0.13, 0.016), M.plate(), 0.006,
                (math.radians(-6), 0, 0)), headg)
        add(box('capstripe', (0, 0.0, 1.845), (0.02, 0.20, 0.012), M.white(), 0.004), headg)
    elif style == 'headset':
        cap_hair()
        add(torus('hsband', (0, 0.01, 1.735), 0.128, 0.012, M.gunmetal(),
                  (0, math.radians(90), 0)), headg)
        for s in (-1, 1):
            add(cyl('hscup%d' % s, (s * 0.115, 0.0, 1.69), 0.043, 0.028, M.gunmetal(),
                    (0, math.radians(90), 0)), headg)
            add(cyl('hscupac%d' % s, (s * 0.13, 0.0, 1.69), 0.035, 0.008, M.plate(),
                    (0, math.radians(90), 0)), headg)
        add(tube('mic', [(0.10, -0.03, 1.66), (0.06, -0.10, 1.625), (0.015, -0.115, 1.615)],
                 0.008, M.gunmetal()), headg)
        add(sphere('mictip', (0.01, -0.116, 1.615), (0.014, 0.014, 0.014), M.plate()), headg)
    elif style == 'antenna':
        cap_hair()
        add(cyl('earpiece', (0.112, 0, 1.70), 0.038, 0.025, M.gunmetal(),
                (0, math.radians(90), 0)), headg)
        add(cyl('ant', (0.112, 0.015, 1.84), 0.006, 0.20, M.steel()), headg)
        add(sphere('anttip', (0.112, 0.015, 1.945), (0.016, 0.016, 0.016), accent_glow), headg)
    elif style == 'visor-strip':
        cap_hair()
        add(box('visorstrip', (0, -0.090, 1.715), (0.195, 0.028, 0.038), M.visor(), 0.012), headg)
        add(box('visorled', (0, -0.108, 1.715), (0.15, 0.008, 0.012), M.glow(None, 4.5), 0.003), headg)
        for s in (-1, 1):
            add(box('visortemple%d' % s, (s * 0.103, -0.03, 1.715), (0.025, 0.10, 0.035),
                    M.gunmetal(), 0.008), headg)
    elif style == 'horn':
        cap_hair()
        for s in (-1, 1):
            add(cone('horn%d' % s, (s * 0.055, -0.045, 1.835), 0.020, 0.11, M.m('hornbone', lin(srgb('#C9BBA4')), 0.0, 0.45),
                     (math.radians(-18), 0, s * math.radians(18))), headg)
    elif style == 'halo':
        cap_hair()
        add(torus('halo', (0, 0.01, 1.915), 0.105, 0.010, accent_glow, (0, 0, 0), 32, 8), headg)
        add(cyl('halostem', (0, 0.09, 1.86), 0.006, 0.10, M.steel()), headg)
    elif style == 'sidegear':
        cap_hair()
        for s in (-1, 1):
            add(cyl('sidegear%d' % s, (s * 0.115, 0, 1.70), 0.05, 0.035, M.plate(),
                    (0, math.radians(90), 0)), headg)
            add(cyl('sidegearled%d' % s, (s * 0.134, 0, 1.70), 0.018, 0.008, M.glow(None, 4.5),
                    (0, math.radians(90), 0)), headg)
    elif style == 'wing':
        cap_hair()
        for s in (-1, 1):
            add(box('wing%d' % s, (s * 0.14, 0.015, 1.77), (0.026, 0.115, 0.10),
                    M.plate(), 0.008, (0, 0, s * math.radians(-28))), headg)
            add(box('wingtip%d' % s, (s * 0.175, 0.06, 1.82), (0.018, 0.07, 0.055),
                    M.white(), 0.006, (0, 0, s * math.radians(-28))), headg)
    elif style == 'helmet':
        # 不透明头盔 + 发光面窗
        add(sphere('helmet', (0, 0.002, 1.72), (0.155, 0.15, 0.165), M.gunmetal()), headg)
        add(sphere('helmetvisor', (0, -0.075, 1.715), (0.115, 0.10, 0.105), M.visor()), headg)
        add(box('helmetled', (0, -0.155, 1.715), (0.13, 0.01, 0.014), M.glow(None, 4.5), 0.003), headg)
        add(torus('helmetring', (0, 0.0, 1.565), 0.12, 0.022, M.plate(), (0, 0, 0)), headg)
        add(box('helmetstripe', (0, 0.005, 1.862), (0.035, 0.22, 0.014), M.plate(), 0.004), headg)
        add(tube('helmetair', [(0.14, 0.05, 1.60), (0.15, 0.13, 1.52), (0.12, 0.19, 1.47)],
                 0.014, M.rubber()), headg)
    elif style == 'dome':
        # 全透明玻璃罩
        add(sphere('dome', (0, 0.0, 1.72), (0.155, 0.155, 0.175), M.glass()), headg)
        add(torus('domering', (0, 0.0, 1.565), 0.12, 0.024, M.plate(), (0, 0, 0)), headg)
        add(box('domelatch', (0, -0.115, 1.565), (0.05, 0.04, 0.04), M.steel(), 0.008), headg)
        add(box('domevisor', (0, -0.118, 1.715), (0.175, 0.022, 0.040), M.visor(), 0.012), headg)
        add(box('domevisorled', (0, -0.132, 1.715), (0.145, 0.006, 0.010), M.glow(None, 3.5), 0.003), headg)
        add(tube('domeair', [(0.14, 0.04, 1.60), (0.15, 0.12, 1.52), (0.12, 0.19, 1.47)],
                 0.014, M.rubber()), headg)

    # 头盔类不再叠加头发
    for ob, parent in C:
        attach(ob, parent)
    return root, [o for o, _ in C] + [root, hips, spine, headg, shL, shR, elL, elR, hiL, hiR, knL, knR]


# ---------------- 动画 ----------------
def pose(rig, phase, mode):
    root, hips, spine, headg, shL, shR, elL, elR, hiL, hiR, knL, knR = rig
    if mode == 'idle':
        b = 0.004 * math.sin(phase)
        hips.location.z = 0.95 + b
        spine.rotation_euler = (0.035, 0, 0)
        shL.rotation_euler = (0.02 * math.sin(phase), -0.13, 0.02)
        shR.rotation_euler = (-0.02 * math.sin(phase), 0.13, -0.02)
        elL.rotation_euler = (-0.16, 0, 0)
        elR.rotation_euler = (-0.16, 0, 0)
        hiL.rotation_euler = (0.01, 0, 0)
        hiR.rotation_euler = (-0.01, 0, 0)
        knL.rotation_euler = (0.03, 0, 0)
        knR.rotation_euler = (0.03, 0, 0)
        headg.rotation_euler = (0.01 * math.sin(phase + 1), 0, 0.02 * math.sin(phase * 0.7))
        return
    s, c = math.sin(phase), math.cos(phase)
    hips.location.z = 0.95 - 0.042 * abs(s) + 0.006
    spine.rotation_euler = (0.07, 0.02 * s, 0)
    shL.rotation_euler = (0.34 * s, -0.13, 0.06)
    shR.rotation_euler = (-0.34 * s, 0.13, -0.06)
    elL.rotation_euler = (-0.30 - 0.10 * max(0, s), 0, 0)
    elR.rotation_euler = (-0.30 - 0.10 * max(0, -s), 0, 0)
    hiL.rotation_euler = (-0.40 * s, 0, 0)
    hiR.rotation_euler = (0.40 * s, 0, 0)
    knL.rotation_euler = (0.06 + 0.42 * max(0, s), 0, 0)
    knR.rotation_euler = (0.06 + 0.42 * max(0, -s), 0, 0)
    headg.rotation_euler = (-0.03, 0, 0.02 * s)


# ---------------- 渲染 ----------------
def render_seat(cfg):
    clear_char()
    root, allobs = build(cfg)
    rig = tuple(bpy.data.objects[n] for n in
                ('root', 'hips', 'spine', 'headg', 'shL', 'shR', 'elL', 'elR',
                 'hiL', 'hiR', 'knL', 'knR'))
    sc = bpy.context.scene
    seat = cfg['seat']
    dirs = [('down', 0.0), ('up', math.pi), ('left', -math.pi / 2), ('right', math.pi / 2)]
    for dname, ang in dirs:
        root.rotation_euler = (0, 0, ang)
        for fr in range(4):
            pose(rig, fr * math.pi / 2, 'walk')
            bpy.context.view_layer.update()
            sc.render.filepath = os.path.join(OUT, 's%02d_%s_%d.png' % (seat, dname, fr))
            bpy.ops.render.render(write_still=True)
    for fr in range(4):
        root.rotation_euler = (0, 0, 0)
        pose(rig, fr * math.pi / 2, 'idle')
        bpy.context.view_layer.update()
        sc.render.filepath = os.path.join(OUT, 's%02d_idle_%d.png' % (seat, fr))
        bpy.ops.render.render(write_still=True)
    print('[crew] seat %02d done' % seat)


def main():
    manifest = json.load(open(os.path.join(ROOT, 'assets', 'scene', 'crew', 'manifest.json'),
                             encoding='utf-8'))
    setup_scene()
    seats = manifest['seats']
    if TEST:
        seats = seats[:1]
    elif SEATS_ARG:
        seats = [s for s in seats if s['seat'] in SEATS_ARG]
    for cfg in seats:
        render_seat(cfg)
    print('[crew] all done ->', OUT)


main()
