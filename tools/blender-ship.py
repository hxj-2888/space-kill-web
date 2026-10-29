# =============================================================
# blender-ship.py · 新返航录 2.5D 整船底图
# -------------------------------------------------------------
# 唯一几何来源：js/data/map.js 的 `SKMapData`（不另存一份地图）。
# 产出：assets/scene/v4/base-lit.png
#   · 正交 2.5D 相机（俯角 12°），地板按世界坐标精确对齐 98×60，
#     墙顶因高度产生 ~0.25 格的屏幕位移 —— 这就是 2.5D 的"厚度"；
#   · 地面/墙面材质来自 assets/scene/v4/tex/（扩散模型出图），
#     经 Blender 的 Object 坐标平铺，跨房间接缝连续；
#   · 家具按 cover.kind 生成简易体块，高度参与遮挡与阴影。
# 用法：
#   blender -b -P tools/blender-ship.py -- [--test] [--cycles] [--res 4704]
#   --test  渲染 960×580 预览到 assets/scene/v4/_preview.png
# 注意：改过 js/data/map.js 的房间 / 墙体 / 门 / 走廊后必须重新渲染，
#       否则 2.5D 底图与逻辑碰撞面会错位。
# =============================================================
import bpy, bmesh, json, math, os, re, sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEST = '--test' in ARGS
FORCE_CYCLES = '--cycles' in ARGS


def argval(name, default):
    if name in ARGS:
        i = ARGS.index(name)
        if i + 1 < len(ARGS):
            return ARGS[i + 1]
    return default


RES_X = int(argval('--res', '960' if TEST else '4704'))
THETA = math.radians(12.0)


# ---------------- 读地图 ----------------
def read_map():
    src = open(os.path.join(ROOT, 'js', 'data', 'map.js'), encoding='utf-8').read()
    i = src.index('global.SKMapData = ')
    j = src.index('{', i)
    depth, instr, esc = 0, False, False
    end = None
    for k in range(j, len(src)):
        ch = src[k]
        if instr:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                instr = False
        else:
            if ch == '"':
                instr = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = k + 1
                    break
    return json.loads(src[j:end])


M = read_map()
W, H = M['bounds']['w'], M['bounds']['h']
CW = M['scale']['corridor_w']

# ---------------- 场景 ----------------
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for me in list(bpy.data.meshes):
    bpy.data.meshes.remove(me)
scene = bpy.context.scene
scene.render.film_transparent = True
scene.render.resolution_x = RES_X
scene.render.resolution_y = round(RES_X * H * math.cos(THETA) / W)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.compression = 55
scene.render.filepath = os.path.join(ROOT, 'assets', 'scene', 'v4',
                                     '_preview.png' if TEST else 'base-lit.png')
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.view_settings.exposure = 1.05

if not FORCE_CYCLES:
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = eng
            break
        except Exception:
            continue
    try:
        scene.eevee.taa_render_samples = 64
    except Exception:
        pass
    try:
        scene.eevee.use_raytracing = True
        scene.eevee.ray_tracing_method = 'SCREEN'
        scene.eevee.ray_tracing_options.resolution_scale = '1'
        scene.eevee.ray_tracing_options.use_denoise = True
        scene.eevee.ray_tracing_options.screen_trace_quality = 0.5
    except Exception as e:
        print('[ship] raytracing off:', e)
else:
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True


# ---------------- 材质 ----------------
def sock(node, names, value):
    for n in names:
        if n in node.inputs:
            try:
                node.inputs[n].default_value = value
                return True
            except Exception:
                pass
    return False


def mat_tex(name, tex, scale=(1 / 4.2, 1 / 4.2, 1.0), metallic=0.55, rough=0.42,
            emit_mul=0.0, tint=None, fallback=None):
    """贴图材质；素材缺失（没跑 SDXL 工具）时退回纯色，保证烘图流程不中断。"""
    path = os.path.join(ROOT, 'assets', 'scene', 'v4', 'tex', tex)
    if not os.path.exists(path):
        print('[ship] 缺贴图 %s，退回纯色材质' % tex)
        c, m, r = fallback or ((0.25, 0.28, 0.32), 0.5, 0.5)
        return mat_plain(name, c, metallic=m, rough=r)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path)
    img.extension = 'REPEAT'
    img.interpolation = 'Linear'
    mapping.inputs['Scale'].default_value = scale
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], img.inputs['Vector'])
    if tint:
        mix = nt.nodes.new('ShaderNodeMixRGB')
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Fac'].default_value = 1.0
        mix.inputs['Color1'].default_value = (*tint, 1)
        nt.links.new(img.outputs['Color'], mix.inputs['Color2'])
        nt.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])
        emit_src = mix.outputs['Color']
    else:
        nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
        emit_src = img.outputs['Color']
    sock(bsdf, ['Metallic'], metallic)
    sock(bsdf, ['Roughness'], rough)
    if emit_mul:
        nt.links.new(emit_src, bsdf.inputs.get('Emission Color') or bsdf.inputs.get('Emission'))
        sock(bsdf, ['Emission Strength'], emit_mul)
    return m


def mat_shadow(name, tex, strength=0.55, z_bias=0.008):
    """接地软阴影：只用 alpha 贴图压暗地面，本身不参与投影。"""
    path = os.path.join(ROOT, 'assets', 'scene', 'v4', 'tex', tex)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    sock(bsdf, ['Base Color'], (0.01, 0.012, 0.016, 1))
    sock(bsdf, ['Metallic'], 0.0)
    sock(bsdf, ['Roughness'], 1.0)
    sock(bsdf, ['Specular IOR Level', 'Specular'], 0.0)
    if os.path.exists(path):
        tex_node = nt.nodes.new('ShaderNodeTexImage')
        tex_node.image = bpy.data.images.load(path)
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = strength
        nt.links.new(tex_node.outputs['Alpha'], mul.inputs[0])
        nt.links.new(mul.outputs['Value'], bsdf.inputs['Alpha'])
    else:
        print('[ship] 缺 %s，接地阴影改用固定 alpha' % tex)
        sock(bsdf, ['Alpha'], strength)
    try:
        m.blend_method = 'BLEND'
        m.show_transparent_back = False
    except Exception:
        pass
    return m


def mat_plain(name, color, metallic=0.4, rough=0.5, emit=None, strength=0.0, alpha=1.0, spec=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    sock(b, ['Base Color'], (*color, 1))
    sock(b, ['Metallic'], metallic)
    sock(b, ['Roughness'], rough)
    sock(b, ['Alpha'], alpha)
    if spec is not None:
        sock(b, ['Specular IOR Level', 'Specular'], spec)
    if emit:
        sock(b, ['Emission Color', 'Emission'], (*emit, 1))
        sock(b, ['Emission Strength'], strength)
    if alpha < 1:
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
    return m


TEX = {
    'bridge': 'floor-carpet.png', 'cam': 'floor-steel.png', 'ecosys': 'floor-eco.png',
    'power': 'floor-grate.png', 'transit': 'floor-steel.png', 'fun': 'floor-steel.png',
    'engine': 'floor-grate.png', 'med': 'floor-lab.png', 'armory': 'floor-hazard.png',
}
FLOOR_SCALE = {'bridge': 1 / 3.4, 'armory': 1 / 3.2, 'med': 1 / 3.0}
FLOOR_TINT = {'armory': (0.72, 0.72, 0.72), 'bridge': (0.85, 0.85, 0.85)}
FLOOR_MATS = {}
for rid, tex in TEX.items():
    sc = FLOOR_SCALE.get(rid, 1 / 2.8)
    FLOOR_MATS[rid] = mat_tex('floor_' + rid, tex, scale=(sc, sc, 1), metallic=0.22, rough=0.62,
                              tint=FLOOR_TINT.get(rid))
FLOOR_MATS['corridor'] = mat_tex('floor_corridor', 'floor-grate.png', scale=(1 / 2.6, 1 / 2.6, 1),
                                 metallic=0.42, rough=0.5, emit_mul=0.14,
                                 tint=(0.72, 0.78, 0.9))
WALL = mat_tex('wall', 'wall-panel.png', scale=(1 / 4.0, 1 / 4.0, 1 / 1.18), metallic=0.62, rough=0.38)
WALL_TOP = mat_plain('wall_top', (0.30, 0.35, 0.42), metallic=0.65, rough=0.32,
                     emit=(0.10, 0.14, 0.18), strength=0.35)
TRIM = mat_plain('trim', (0.05, 0.07, 0.09), metallic=0.6, rough=0.6)
CYAN = mat_plain('emit_cyan', (0.06, 0.2, 0.26), metallic=0.2, rough=0.3,
                 emit=(0.12, 0.72, 0.95), strength=5.0)
AMBER = mat_plain('emit_amber', (0.25, 0.18, 0.06), metallic=0.2, rough=0.3,
                  emit=(0.95, 0.62, 0.18), strength=4.0)
RED = mat_plain('emit_red', (0.3, 0.05, 0.04), emit=(0.95, 0.15, 0.1), strength=5.0)
SCREEN = mat_plain('screen', (0.02, 0.05, 0.07), metallic=0.1, rough=0.15,
                   emit=(0.1, 0.55, 0.7), strength=1.6)
METAL = mat_plain('metal', (0.22, 0.25, 0.29), metallic=0.75, rough=0.4)
TABLE_TOP = mat_plain('table_top', (0.006, 0.008, 0.012), metallic=0.30, rough=0.55, spec=0.18)
TABLE_RING = mat_plain('table_ring', (0.22, 0.12, 0.03), metallic=0.2, rough=0.35,
                       emit=(1.0, 0.52, 0.12), strength=1.5)
TABLE_HOLO = mat_plain('table_holo', (0.02, 0.09, 0.12), metallic=0.1, rough=0.25,
                       emit=(0.10, 0.62, 0.85), strength=1.3)
DARK = mat_plain('dark', (0.08, 0.10, 0.12), metallic=0.6, rough=0.55)
WOOD = mat_plain('wood', (0.24, 0.17, 0.11), metallic=0.1, rough=0.7)
FABRIC = mat_plain('fabric', (0.18, 0.16, 0.14), metallic=0.0, rough=0.95)
LEAF = mat_plain('leaf', (0.06, 0.22, 0.08), metallic=0.0, rough=0.8)
GLASS = mat_plain('glass', (0.05, 0.28, 0.22), metallic=0.2, rough=0.15, alpha=0.72,
                  emit=(0.05, 0.35, 0.25), strength=0.8)
WATER = mat_plain('water', (0.03, 0.12, 0.22), metallic=0.3, rough=0.06,
                  emit=(0.02, 0.18, 0.35), strength=1.2)
WHITE = mat_plain('white', (0.62, 0.70, 0.76), metallic=0.25, rough=0.45)
BLANKET = mat_plain('blanket', (0.18, 0.30, 0.42), metallic=0.0, rough=0.95)

# ---------------- 家具表面材质（gen-materials.py 生成，缺失时自动退回纯色） ----------------
# emit_mul：让设备面板自带一点冷光，暗舱（引擎 / 配电）里也能读出掩体轮廓，
# 不至于和地板糊成一片黑。
PANEL = mat_tex('panel_metal', 'panel-metal.png', scale=(1 / 2.6, 1 / 2.6, 1 / 1.4),
                metallic=0.70, rough=0.36, emit_mul=0.26, tint=(0.98, 1.02, 1.10),
                fallback=((0.13, 0.15, 0.18), 0.72, 0.36))
PANEL_LIGHT = mat_tex('panel_metal_light', 'panel-metal.png', scale=(1 / 2.2, 1 / 2.2, 1 / 1.2),
                      metallic=0.64, rough=0.42, emit_mul=0.20, tint=(1.10, 1.14, 1.20),
                      fallback=((0.24, 0.27, 0.31), 0.66, 0.42))
CRATE = mat_tex('crate_steel', 'crate-steel.png', scale=(1 / 1.9, 1 / 1.9, 1 / 1.0),
                metallic=0.56, rough=0.52, emit_mul=0.24, tint=(1.06, 0.98, 0.82),
                fallback=((0.20, 0.18, 0.15), 0.5, 0.6))
FABRIC_TEX = mat_tex('fabric_weave', 'fabric-weave.png', scale=(1 / 1.5, 1 / 1.5, 1 / 1.0),
                     metallic=0.0, rough=0.94, emit_mul=0.08, tint=(0.86, 0.96, 1.06),
                     fallback=((0.10, 0.13, 0.16), 0.0, 0.94))
TOPPLATE = mat_tex('table_composite', 'table-composite.png', scale=(1 / 3.0, 1 / 3.0, 1.0),
                   metallic=0.24, rough=0.44, emit_mul=0.16, tint=(0.92, 0.96, 1.04),
                   fallback=((0.10, 0.11, 0.13), 0.24, 0.44))
MEDWHITE = mat_tex('panel_white', 'panel-white.png', scale=(1 / 2.4, 1 / 2.4, 1 / 1.2),
                   metallic=0.16, rough=0.42, emit_mul=0.10, tint=(0.96, 0.99, 1.03),
                   fallback=((0.60, 0.66, 0.70), 0.16, 0.42))
HAZ = mat_tex('hazard_stripe', 'hazard-stripe.png', scale=(1 / 1.1, 1 / 1.1, 1.0),
              metallic=0.18, rough=0.62, emit_mul=0.18, tint=(1.05, 0.98, 0.88),
              fallback=((0.32, 0.20, 0.05), 0.2, 0.6))
SHADOW = mat_shadow('ao_shadow', 'ao-soft.png', strength=0.62)


# ---------------- 家具细节工具 ----------------
def shadow_decal(tag, cx, cy, w, d, z=0.008, grow=1.0):
    """家具脚下的软阴影贴片：把物体"压"进地板，消除贴纸感。"""
    me = bpy.data.meshes.new(tag)
    hw, hd = w * grow / 2, d * grow / 2
    me.from_pydata([(-hw, -hd, z), (hw, -hd, z), (hw, hd, z), (-hw, hd, z)], [], [(0, 1, 2, 3)])
    me.validate()
    recalc(me)
    ob = link(bpy.data.objects.new(tag, me))
    ob.location = (cx, cy, 0)
    ob.data.materials.append(SHADOW)
    try:
        ob.visible_shadow = False
    except Exception:
        pass
    return ob


def floor_frame(tag, cx, cy, w, d, mat=HAZ, z0=0.006, z1=0.014, bar=0.13, gap=0.22):
    """设备周边的地面警戒框：说明"这是台要维护的机器"，同时统一家具与地板的色调。"""
    ow, od = w + gap * 2, d + gap * 2
    box(tag + '_h1', cx, cy - od / 2, ow, bar, z0, z1, mat)
    box(tag + '_h2', cx, cy + od / 2, ow, bar, z0, z1, mat)
    box(tag + '_v1', cx - ow / 2, cy, bar, od - bar * 2, z0, z1, mat)
    box(tag + '_v2', cx + ow / 2, cy, bar, od - bar * 2, z0, z1, mat)


def bolts(tag, cx, cy, w, d, z, r=0.035, inset=0.12, mat=DARK):
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(tag + '_b%d%d' % (sx, sy), cx + sx * (w / 2 - inset), cy + sy * (d / 2 - inset),
                r, z, z + 0.02, mat, verts=8)


def vent(tag, cx, cy, w, d, z0, n=5, mat=DARK):
    """百叶散热口：一组薄板，替代原来一整块纯色面板。"""
    step = d / max(1, n)
    for i in range(n):
        box(tag + '_v%d' % i, cx, cy - d / 2 + step * (i + 0.5), w, step * 0.42, z0, z0 + 0.022, mat)


def led_strip(tag, cx, cy, w, z, mat=CYAN, n=3):
    step = w / max(1, n)
    for i in range(n):
        box(tag + '_l%d' % i, cx - w / 2 + step * (i + 0.5), cy, step * 0.42, 0.05, z, z + 0.03, mat)


def pipe_run(tag, x0, y0, x1, y1, z, r=0.06, mat=METAL):
    """家具之间的短管线/线缆：让设备看起来接在船上，而不是摆在地板上的方块。"""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    if L < 0.05:
        return
    box(tag, (x0 + x1) / 2, (y0 + y1) / 2, L, r * 2, z - r, z + r, mat,
        rot=math.atan2(dy, dx))


# ---------------- 网格工具 ----------------
def link(ob):
    bpy.context.collection.objects.link(ob)
    return ob


def recalc(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()


def poly_obj(name, pts, mat, z=0.0):
    verts = [(x, y, z) for x, y in pts]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [list(range(len(verts)))])
    me.validate()
    recalc(me)
    ob = link(bpy.data.objects.new(name, me))
    ob.data.materials.append(mat)
    return ob


def box(name, cx, cy, w, d, z0, z1, mat, rot=0.0, bevel=0.0, mats=None):
    hw, hd = w / 2, d / 2
    c, s = math.cos(rot), math.sin(rot)
    base = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    verts = []
    for z in (z0, z1):
        for x, y in base:
            verts.append((cx + x * c - y * s, cy + x * s + y * c, z))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    recalc(me)
    ob = link(bpy.data.objects.new(name, me))
    ob.data.materials.append(mat)
    if mats:
        for m2 in mats:
            ob.data.materials.append(m2)
        for p in me.polygons:
            p.material_index = 1 if p.normal.z > 0.7 else 0
    if bevel > 0:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 2
        b.limit_method = 'ANGLE'
    return ob


def cyl(name, x, y, r, z0, z1, mat, verts=24, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts,
                          radius1=r, radius2=r, depth=z1 - z0)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = (x, y, (z0 + z1) / 2)
    ob.data.materials.append(mat)
    if bevel > 0:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 2
    return ob


def ball(name, x, y, z, r, mat, subdiv=2):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = (x, y, z)
    ob.data.materials.append(mat)
    return ob


# ---------------- 地板 / 走廊 ----------------
for r in M['rooms']:
    poly_obj('floor_' + r['id'], r['poly'], FLOOR_MATS[r['id']], z=0.0)

for c in M['corridors']:
    pts = c['pts']
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        rot = math.atan2(dy, dx)
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        box('corr_%s_%d' % (c['id'], i), mx, my,
            L + CW, CW, -0.02, 0.0, FLOOR_MATS['corridor'], rot=rot)
        # 走廊两侧的地面导光条：暗走廊里唯一的方向感来源
        ux, uy = dx / L, dy / L
        for side in (-1, 1):
            ox, oy = -uy * (CW / 2 - 0.22) * side, ux * (CW / 2 - 0.22) * side
            box('corr_glow_%s_%d_%d' % (c['id'], i, side), mx + ox, my + oy,
                L - 0.4, 0.07, 0.012, 0.030, CYAN, rot=rot)

# 门槛灯：每条门缝一条琥珀色贴地灯，兼作"这里能过去"的视觉提示
# 自动门门框也在这里烘焙：门板由游戏内动态绘制（扩散纹理），底座只留框与指示灯。
for r in M['rooms']:
    x0, y0, rw, rh = r['rect']
    for side, t in r['doors']:
        horiz = side in ('t', 'b')
        if horiz:
            cx, cy = t, (y0 if side == 't' else y0 + rh)
        else:
            cx, cy = (x0 if side == 'l' else x0 + rw), t
        rot = 0.0 if horiz else math.pi / 2
        tag = 'door_%s_%s_%s' % (r['id'], side, t)
        # 地面暗轨 + 琥珀门槛灯
        box(tag + '_track', cx, cy, 2.34, 0.40, 0.004, 0.018, DARK, rot=rot)
        box(tag, cx, cy, 2.0, 0.16, 0.020, 0.042, AMBER, rot=rot)
        # 两侧门柱（留出 1.8 格净宽）
        for s in (-1, 1):
            px = cx + (1.02 * s if horiz else 0)
            py = cy + (0 if horiz else 1.02 * s)
            box(tag + '_jamb_%d' % s, px, py,
                0.16 if horiz else 0.46, 0.46 if horiz else 0.16,
                0.0, 1.26, TRIM, rot=rot, bevel=0.02)
        # 门楣 + 状态灯（动态门板的开合状态在游戏里覆盖这盏灯）
        box(tag + '_lintel', cx, cy, 2.30, 0.46, 1.18, 1.34, DARK, rot=rot, bevel=0.02)
        lx = cx + (0 if horiz else (-0.27 if side == 'l' else 0.27))
        ly = cy + ((-0.27 if side == 't' else 0.27) if horiz else 0)
        box(tag + '_light', lx, ly,
            1.78 if horiz else 0.06, 0.06 if horiz else 1.78,
            1.20, 1.26, AMBER, rot=rot)

# ---------------- 墙 ----------------
wall_i = 0
for seg in M['walls']:
    (ax, ay), (bx, by) = seg
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy)
    if L < 0.05:
        continue
    rot = math.atan2(dy, dx)
    cx, cy = (ax + bx) / 2, (ay + by) / 2
    ob = box('wall_%d' % wall_i, cx, cy, L + 0.12, 0.34, 0.0, 1.16, WALL, rot=rot,
             bevel=0.03, mats=[WALL, WALL_TOP])
    # 墙脚阴影条
    box('wall_trim_%d' % wall_i, cx, cy, L + 0.10, 0.40, 0.0, 0.06, TRIM, rot=rot)
    # 长墙中点挂一盏灯（不影响导航，只是材质高光）
    if L >= 4.0:
        ux, uy = dx / L, dy / L
        lx, ly = cx - uy * 0.19, cy + ux * 0.19
        box('wall_lamp_%d' % wall_i, lx, ly, min(L * 0.55, 1.4), 0.05, 0.90, 0.985, CYAN, rot=rot)
    wall_i += 1

# ---------------- 家具 ----------------
def furniture(c):
    x, y, w, h, k = c['x'], c['y'], c['w'], c['h'], c['kind']
    cx, cy = x + w / 2, y + h / 2
    tag = 'f_%s_%s' % (k, c.get('label', ''))
    if k != 'pond':
        shadow_decal(tag + '_ao', cx, cy, w, h, grow=1.9)
    if k == 'table' and c.get('label') == '圆桌':
        R = min(w, h) / 2
        # 深色全息会议桌：冷灰桌面 + 琥珀外圈 + 青色任务环 + 八条刻度
        cyl('f_round_table', cx, cy, R, 0.70, 0.78, TABLE_TOP, verts=48, bevel=0.02)
        cyl('f_round_table_ring', cx, cy, R * 0.995, 0.78, 0.80, TABLE_RING, verts=48)
        cyl('f_round_table_lid', cx, cy, R * 0.96, 0.80, 0.84, TABLE_TOP, verts=48, bevel=0.015)
        cyl('f_round_table_pole', cx, cy, 0.22, 0, 0.70, TRIM, verts=16)
        cyl('f_round_table_holo', cx, cy, R * 0.57, 0.841, 0.845, TABLE_HOLO, verts=48)
        cyl('f_round_table_holo_cap', cx, cy, R * 0.54, 0.8455, 0.847, TABLE_TOP, verts=48)
        cyl('f_round_table_core', cx, cy, R * 0.11, 0.8475, 0.850, TABLE_HOLO, verts=24)
        cyl('f_round_table_core_dot', cx, cy, R * 0.04, 0.8505, 0.852, TABLE_RING, verts=16)
        for i in range(8):
            a = math.pi * 2 * i / 8
            rr = R * 0.73
            box('f_round_table_tick_%d' % i, cx + math.cos(a) * rr, cy + math.sin(a) * rr,
                0.34, 0.05, 0.8405, 0.8435, TABLE_RING, rot=a)
    elif k == 'table':
        # 台面用磨砂复合板材质，边缘留暗色包边与琥珀细线，桌腿带地脚垫
        box(tag + '_top', cx, cy, w, h, 0.72, 0.82, TOPPLATE, bevel=0.03)
        box(tag + '_rim', cx, cy, w + 0.05, h + 0.05, 0.70, 0.735, TRIM, bevel=0.02)
        for side in (-1, 1):
            box(tag + '_edge_x', cx, cy + side * (h / 2 - 0.02), w, 0.04, 0.80, 0.83, AMBER)
            box(tag + '_edge_y', cx + side * (w / 2 - 0.02), cy, 0.04, h, 0.80, 0.83, AMBER)
        box(tag + '_shelf', cx, cy, w * 0.82, h * 0.66, 0.30, 0.335, DARK)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            lx, ly = cx + sx * (w / 2 - 0.16), cy + sy * (h / 2 - 0.16)
            box(tag + '_leg', lx, ly, 0.10, 0.10, 0.06, 0.72, METAL, bevel=0.015)
            cyl(tag + '_foot', lx, ly, 0.11, 0.0, 0.06, DARK, verts=12)
    elif k == 'console':
        # 机柜 + 斜面操作台 + 散热百叶 + 状态灯带 + 地面警戒框
        box(tag + '_body', cx, cy, w, h, 0.0, 0.86, PANEL, bevel=0.035)
        box(tag + '_cap', cx, cy, w * 1.02, h * 1.02, 0.86, 0.90, PANEL_LIGHT, bevel=0.02)
        box(tag + '_slope', cx, cy - h * 0.10, w * 0.86, h * 0.42, 0.90, 0.985, SCREEN, rot=0.0)
        box(tag + '_slope_trim', cx, cy - h * 0.10, w * 0.92, h * 0.46, 0.885, 0.905, TRIM)
        vent(tag + '_vent', cx, cy + h * 0.30, w * 0.66, h * 0.22, 0.30, n=5)
        led_strip(tag + '_led', cx, cy + h * 0.46, w * 0.7, 0.905, CYAN, n=4)
        bolts(tag + '_bolt', cx, cy, w, h, 0.905, r=0.03, inset=0.10, mat=METAL)
        floor_frame(tag + '_hz', cx, cy, w, h)
        pipe_run(tag + '_cable', cx, cy + h / 2, cx + w * 0.35, cy + h / 2 + 0.9, 0.05, 0.045, DARK)
    elif k == 'pillar':
        r = min(w, h) * 0.44
        cyl(tag + '_body', cx, cy, r, 0.10, 1.30, PANEL_LIGHT, verts=20, bevel=0.02)
        cyl(tag + '_base', cx, cy, r * 1.22, 0.0, 0.12, DARK, verts=20)
        cyl(tag + '_cap', cx, cy, r * 1.14, 1.28, 1.36, TRIM, verts=20)
        cyl(tag + '_band', cx, cy, r * 1.03, 0.42, 0.56, HAZ, verts=20)
        cyl(tag + '_ring', cx, cy, r * 1.05, 0.98, 1.02, CYAN, verts=20)
        box(tag + '_plate', cx + r, cy, 0.10, r * 0.9, 0.62, 0.86, DARK)
    elif k == 'tank':
        r = min(w, h) * 0.44
        cyl(tag + '_base', cx, cy, r * 1.24, 0.0, 0.14, METAL, verts=24)
        cyl(tag + '_glass', cx, cy, r, 0.14, 1.80, GLASS, verts=24, bevel=0.02)
        cyl(tag + '_liquid', cx, cy, r * 0.9, 0.20, 1.42, WATER, verts=24)
        cyl(tag + '_ring1', cx, cy, r * 1.06, 0.52, 0.62, METAL, verts=24)
        cyl(tag + '_ring2', cx, cy, r * 1.06, 1.28, 1.38, METAL, verts=24)
        cyl(tag + '_cap', cx, cy, r * 1.12, 1.80, 1.92, PANEL_LIGHT, verts=24, bevel=0.02)
        cyl(tag + '_cap_led', cx, cy, r * 0.5, 1.92, 1.95, CYAN, verts=20)
        ball(tag + '_core', cx, cy, 0.92, r * 0.30, LEAF)
        for i in range(3):
            a = math.pi * 2 * i / 3
            ball(tag + '_bub%d' % i, cx + math.cos(a) * r * 0.4, cy + math.sin(a) * r * 0.4,
                 0.62 + i * 0.32, r * 0.07, WATER)
        led_strip(tag + '_led', cx, cy + r * 1.2, r * 1.2, 0.14, AMBER, n=3)
    elif k == 'tree':
        cyl(tag + '_soil', cx, cy, min(w, h) * 0.42, 0.0, 0.16, DARK, verts=18)
        cyl(tag + '_pot', cx, cy, min(w, h) * 0.46, 0.0, 0.22, TRIM, verts=18)
        cyl(tag + '_trunk', cx, cy, min(w, h) * 0.09, 0.16, 1.05, WOOD, verts=10)
        ball(tag + '_leaf1', cx, cy, 1.10, min(w, h) * 0.50, LEAF)
        ball(tag + '_leaf2', cx + w * 0.18, cy - h * 0.12, 1.32, min(w, h) * 0.36, LEAF)
        ball(tag + '_leaf3', cx - w * 0.16, cy + h * 0.15, 1.24, min(w, h) * 0.32, LEAF)
        ball(tag + '_leaf4', cx - w * 0.05, cy - h * 0.20, 1.44, min(w, h) * 0.26, LEAF)
    elif k == 'pond':
        box(tag + '_water', cx, cy, w, h, 0.0, 0.05, WATER)
        box(tag + '_rim', cx, cy, w + 0.24, h + 0.24, 0.0, 0.10, TRIM, bevel=0.03)
        box(tag + '_rim_in', cx, cy, w - 0.06, h - 0.06, 0.045, 0.075, DARK)
        for i, (ox, oy, rr) in enumerate(((-0.32, 0.24, 0.16), (0.28, -0.18, 0.13), (0.05, 0.30, 0.10))):
            ball(tag + '_stone%d' % i, cx + ox * w, cy + oy * h, 0.05, rr * min(w, h) * 0.4, WHITE)
        cyl(tag + '_lily', cx - w * 0.18, cy - h * 0.20, min(w, h) * 0.10, 0.052, 0.062, LEAF, verts=14)
    elif k == 'machine':
        # 主体 + 顶盖 + 前屏 + 灯带 + 散热 + 管线 + 地面警戒框：让方块读成"一台设备"
        box(tag + '_body', cx, cy, w, h, 0.0, 1.06, PANEL, bevel=0.05)
        box(tag + '_cap', cx, cy, w * 0.94, h * 0.94, 1.06, 1.14, PANEL_LIGHT, bevel=0.03)
        box(tag + '_cap_in', cx, cy, w * 0.6, h * 0.6, 1.14, 1.16, DARK)
        box(tag + '_panel', cx, cy - h * 0.30, w * 0.70, h * 0.20, 0.42, 0.80, SCREEN)
        box(tag + '_panel_trim', cx, cy - h * 0.30, w * 0.76, h * 0.24, 0.40, 0.425, TRIM)
        led_strip(tag + '_led', cx, cy + h * 0.34, w * 0.62, 0.90, CYAN, n=4)
        vent(tag + '_vent', cx - w * 0.32, cy, h * 0.5, w * 0.22, 0.24, n=6)
        box(tag + '_haz', cx, cy + h * 0.5, w * 1.01, h * 0.08, 0.16, 0.30, HAZ)
        cyl(tag + '_stack', cx + w * 0.30, cy + h * 0.22, min(w, h) * 0.12, 1.14, 1.52, METAL, verts=14)
        cyl(tag + '_stack_cap', cx + w * 0.30, cy + h * 0.22, min(w, h) * 0.15, 1.50, 1.56, DARK, verts=14)
        pipe_run(tag + '_pipe', cx - w * 0.45, cy + h * 0.35, cx + w * 0.30, cy + h * 0.22, 1.20, 0.055)
        bolts(tag + '_bolt', cx, cy, w, h, 1.14, r=0.035, inset=0.14, mat=METAL)
        floor_frame(tag + '_hzf', cx, cy, w, h)
    elif k == 'crate':
        # 钢板货箱：框筋 + 警戒色带 + 顶盖缝 + 锁扣，替换原来的纯色木盒
        box(tag + '_body', cx, cy, w, h, 0.0, 0.84, CRATE, bevel=0.045)
        box(tag + '_lid', cx, cy, w * 0.96, h * 0.96, 0.84, 0.90, PANEL_LIGHT, bevel=0.025)
        box(tag + '_seam', cx, cy, w * 1.005, h * 1.005, 0.815, 0.835, DARK)
        for sx in (-1, 1):
            box(tag + '_post_l%d' % sx, cx + sx * (w / 2 - 0.06), cy, 0.12, h * 1.01, 0.0, 0.88, DARK)
            box(tag + '_post_w%d' % sx, cx, cy + sx * (h / 2 - 0.06), w * 1.01, 0.12, 0.0, 0.88, DARK)
        box(tag + '_band', cx, cy, w * 1.02, h * 0.20, 0.34, 0.42, HAZ)
        box(tag + '_latch', cx + w * 0.30, cy - h * 0.5, w * 0.18, 0.07, 0.44, 0.62, METAL)
        box(tag + '_plate', cx - w * 0.22, cy - h * 0.5, w * 0.30, 0.05, 0.50, 0.68, WHITE)
        bolts(tag + '_bolt', cx, cy, w, h, 0.90, r=0.03, inset=0.13, mat=METAL)
        floor_frame(tag + '_hzf', cx, cy, w, h, bar=0.10, gap=0.16)
    elif k == 'breaker':
        box(tag + '_body', cx, cy, w, h, 0.0, 1.22, PANEL, bevel=0.035)
        box(tag + '_door', cx, cy - h * 0.5, w * 0.92, 0.06, 0.22, 1.10, PANEL_LIGHT)
        box(tag + '_screen', cx, cy - h * 0.5, w * 0.55, 0.05, 0.86, 1.02, AMBER)
        box(tag + '_haz', cx, cy, w * 1.01, h * 1.01, 0.14, 0.26, HAZ)
        box(tag + '_lever', cx + w * 0.22, cy - h * 0.52, 0.09, 0.09, 0.42, 0.72, RED)
        cyl(tag + '_knob', cx + w * 0.22, cy - h * 0.56, 0.075, 0.70, 0.76, METAL, verts=12)
        led_strip(tag + '_led', cx, cy + h * 0.5, w * 0.6, 1.22, CYAN, n=3)
        pipe_run(tag + '_cond', cx, cy + h / 2, cx, cy + h / 2 + 1.2, 1.05, 0.07, DARK)
        floor_frame(tag + '_hzf', cx, cy, w, h)
    elif k == 'sofa':
        box(tag + '_base', cx, cy, w, h, 0.10, 0.42, FABRIC_TEX, bevel=0.06)
        box(tag + '_back', cx, cy - h / 2 + 0.11, w, 0.22, 0.42, 0.86, FABRIC_TEX, bevel=0.05)
        box(tag + '_arm_l', cx - w / 2 + 0.11, cy, 0.22, h, 0.42, 0.66, FABRIC_TEX, bevel=0.05)
        box(tag + '_arm_r', cx + w / 2 - 0.11, cy, 0.22, h, 0.42, 0.66, FABRIC_TEX, bevel=0.05)
        for i, sx in enumerate((-1, 1)):
            box(tag + '_cush%d' % i, cx + sx * w * 0.22, cy + 0.03, w * 0.40, h * 0.72,
                0.42, 0.52, FABRIC_TEX, bevel=0.04)
        for li, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            cyl(tag + '_leg%d' % li, cx + sx * (w / 2 - 0.14), cy + sy * (h / 2 - 0.14),
                0.045, 0.0, 0.11, METAL, verts=8)
    elif k == 'chair':
        box(tag + '_seat', cx, cy, w, h, 0.36, 0.48, FABRIC_TEX, bevel=0.05)
        box(tag + '_back', cx, cy - h / 2 + 0.07, w * 0.94, 0.14, 0.48, 0.94, FABRIC_TEX, bevel=0.04)
        box(tag + '_back_post', cx, cy - h / 2 + 0.07, 0.07, 0.07, 0.44, 0.52, DARK)
        cyl(tag + '_pole', cx, cy, 0.05, 0.12, 0.36, DARK, verts=10)
        for i in range(5):
            a = math.pi * 2 * i / 5
            box(tag + '_arm%d' % i, cx + math.cos(a) * 0.16, cy + math.sin(a) * 0.16,
                0.30, 0.05, 0.06, 0.12, DARK, rot=a)
            cyl(tag + '_cast%d' % i, cx + math.cos(a) * 0.28, cy + math.sin(a) * 0.28,
                0.035, 0.0, 0.07, METAL, verts=8)
    elif k == 'bed':
        box(tag + '_frame', cx, cy, w, h, 0.0, 0.14, METAL, bevel=0.02)
        box(tag + '_body', cx, cy, w * 0.98, h * 0.98, 0.40, 0.52, MEDWHITE, bevel=0.04)
        box(tag + '_mattress', cx, cy, w * 0.92, h * 0.94, 0.52, 0.62, WHITE, bevel=0.05)
        box(tag + '_blanket', cx, cy + h * 0.14, w * 0.94, h * 0.66, 0.60, 0.665, BLANKET, bevel=0.03)
        box(tag + '_blanket_fold', cx, cy - h * 0.16, w * 0.94, h * 0.08, 0.62, 0.68, FABRIC_TEX, bevel=0.02)
        box(tag + '_pillow', cx, cy - h / 2 + 0.32, w * 0.58, 0.40, 0.62, 0.74, WHITE, bevel=0.07)
        for sx in (-1, 1):
            box(tag + '_rail%d' % sx, cx + sx * (w / 2 - 0.05), cy + h * 0.10, 0.05, h * 0.42,
                0.52, 0.80, METAL, bevel=0.015)
        cyl(tag + '_pole', cx - w * 0.42, cy - h * 0.42, 0.035, 0.14, 1.10, METAL, verts=10)
        box(tag + '_monitor', cx - w * 0.42, cy - h * 0.42, 0.30, 0.06, 0.98, 1.14, SCREEN)
        box(tag + '_pad', cx, cy, w * 1.35, h * 1.18, 0.005, 0.012, MEDWHITE)
    elif k == 'fridge':
        box(tag + '_body', cx, cy, w, h, 0.0, 1.46, MEDWHITE, bevel=0.045)
        box(tag + '_top', cx, cy, w * 1.01, h * 1.01, 1.46, 1.50, PANEL_LIGHT, bevel=0.02)
        box(tag + '_seam', cx, cy, w * 1.015, h * 0.022, 0.70, 0.735, DARK)
        box(tag + '_seam_v', cx, cy, w * 0.022, h * 1.015, 0.02, 1.44, DARK)
        for sx in (-1, 1):
            box(tag + '_handle%d' % sx, cx + sx * w * 0.18, cy - h * 0.5, 0.05, 0.05,
                0.86, 1.12, METAL)
        box(tag + '_label', cx - w * 0.20, cy - h * 0.5, w * 0.30, 0.04, 1.16, 1.30, CYAN)
        vent(tag + '_vent', cx, cy + h * 0.5, w * 0.66, h * 0.16, 1.24, n=4)
        led_strip(tag + '_led', cx, cy - h * 0.5, w * 0.5, 0.05, CYAN, n=3)
        floor_frame(tag + '_hzf', cx, cy, w, h, bar=0.10, gap=0.16)
    elif k == 'rack':
        box(tag + '_frame', cx, cy, w, h, 0.0, 1.46, DARK, bevel=0.03)
        for sx in (-1, 1):
            box(tag + '_side%d' % sx, cx + sx * (w / 2 - 0.04), cy, 0.08, h * 1.01, 0.02, 1.44, PANEL)
        for i in range(4):
            z = 0.22 + i * 0.30
            box(tag + '_slot%d' % i, cx, cy - h * 0.36 + i * h * 0.24, w * 0.74, h * 0.10,
                z, z + 0.09, PANEL_LIGHT, bevel=0.01)
            led_strip(tag + '_slot_led%d' % i, cx + w * 0.22, cy - h * 0.36 + i * h * 0.24,
                      w * 0.22, z + 0.09, AMBER if i % 2 else CYAN, n=2)
        box(tag + '_cap', cx, cy, w * 1.02, h * 1.02, 1.44, 1.50, TRIM, bevel=0.02)
        vent(tag + '_vent', cx, cy + h * 0.44, w * 0.6, h * 0.12, 1.30, n=4)
        pipe_run(tag + '_cable', cx, cy + h / 2, cx - w * 0.4, cy + h / 2 + 1.0, 0.06, 0.05, DARK)
        floor_frame(tag + '_hzf', cx, cy, w, h, bar=0.10, gap=0.16)
    else:
        box(tag + '_body', cx, cy, w, h, 0.0, 0.7, PANEL, bevel=0.03)
        box(tag + '_cap', cx, cy, w * 0.96, h * 0.96, 0.70, 0.74, PANEL_LIGHT, bevel=0.02)


for c in M['cover']:
    furniture(c)

# ---------------- 灯光 ----------------
def area(name, x, y, z, size, energy, color=(1, 1, 1), shape='SQUARE'):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.shape = shape
    d.size = size
    d.color = color
    ob = link(bpy.data.objects.new(name, d))
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, 0)
    return ob


area('key', W * 0.35, H * 0.30, 9.0, 26.0, 1500.0, (0.78, 0.88, 1.0))
area('fill', W * 0.70, H * 0.75, 7.0, 22.0, 900.0, (1.0, 0.84, 0.62))
area('rim', W * 0.15, H * 0.85, 6.0, 16.0, 650.0, (0.55, 0.75, 1.0))
# 每间房一盏吊顶灯：保证暗房也能读出地面材质与掩体轮廓。
# 注意：烘焙图是"亮版"，游戏里未点亮的舱室由 fog 叠层压暗，
# 所以这里不能把暗舱烘得过黑，否则手电锥里也看不清掩体。
ROOM_LIGHT = {
    'bridge': ((0.78, 0.86, 1.0), 1.00), 'cam': ((0.72, 0.82, 1.0), 0.85),
    'ecosys': ((0.62, 0.95, 0.72), 0.90), 'power': ((0.68, 0.76, 1.0), 0.92),
    'transit': ((0.85, 0.88, 1.0), 0.88), 'fun': ((1.0, 0.80, 0.55), 0.88),
    'engine': ((1.0, 0.66, 0.50), 0.95), 'med': ((0.82, 0.94, 1.0), 1.00),
    'armory': ((1.0, 0.76, 0.45), 0.90),
}
for r in M['rooms']:
    x0, y0, rw, rh = r['rect']
    col, mul = ROOM_LIGHT.get(r['id'], ((1, 1, 1), 0.8))
    area('room_' + r['id'], x0 + rw / 2, y0 + rh / 2, 4.6,
         max(6.0, min(rw, rh) * 1.3), (90 + r['area'] * 1.7) * mul, col)

world = bpy.data.worlds.new('world') if not scene.world else scene.world
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.012, 0.016, 0.024, 1)
    bg.inputs['Strength'].default_value = 0.6

# ---------------- 相机 ----------------
cd = bpy.data.cameras.new('cam')
cd.type = 'ORTHO'
cd.ortho_scale = W
cd.sensor_fit = 'HORIZONTAL'
cd.clip_start = 0.1
cd.clip_end = 200
cam = link(bpy.data.objects.new('cam', cd))
D = 60.0
# 相机在北侧向南看：墙顶在原始图里向"下"偏；再经合成器 Flip Y，
# 最终图 = 世界 y=0 在顶部、墙顶向上"长"，与游戏的屏幕坐标一致。
cam.location = (W / 2, H / 2 + math.sin(THETA) * D, math.cos(THETA) * D)
cam.rotation_euler = (-THETA, 0, 0)
scene.camera = cam

# 合成器：只做一次垂直翻转（正交 2.5D 相机的 Y 轴与画布 Y 轴方向相反）
# Blender 5.x 的合成器已改为 node group：scene.compositing_node_group
scene.use_nodes = True
nt = bpy.data.node_groups.new('ShipComp', 'CompositorNodeTree')
scene.compositing_node_group = nt
nt.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
rl = nt.nodes.new('CompositorNodeRLayers')
flip = nt.nodes.new('CompositorNodeFlip')
flip.inputs['Flip Y'].default_value = True
go = nt.nodes.new('NodeGroupOutput')
nt.links.new(rl.outputs['Image'], flip.inputs['Image'])
nt.links.new(flip.outputs['Image'], go.inputs[0])

# 材质贴图需要 Object 坐标 = 世界坐标：统一清空物体变换
bpy.context.view_layer.update()
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True, properties=False)

print('[ship] rooms=%d walls=%d cover=%d res=%dx%d engine=%s' % (
    len(M['rooms']), wall_i, len(M['cover']), scene.render.resolution_x,
    scene.render.resolution_y, scene.render.engine))
bpy.ops.render.render(write_still=True)
print('[ship] wrote ' + scene.render.filepath)
