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
            emit_mul=0.0, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(os.path.join(ROOT, 'assets', 'scene', 'v4', 'tex', tex))
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
        box('f_table_top', cx, cy, w, h, 0.72, 0.82, METAL, bevel=0.04)
        for side in (-1, 1):
            box('f_table_edge_x', cx, cy + side * (h / 2 - 0.03), w, 0.06, 0.80, 0.84, AMBER)
            box('f_table_edge_y', cx + side * (w / 2 - 0.03), cy, 0.06, h, 0.80, 0.84, AMBER)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            cyl('f_table_leg', cx + sx * (w / 2 - 0.16), cy + sy * (h / 2 - 0.16), 0.055, 0, 0.72, DARK)
    elif k == 'console':
        box('f_console', cx, cy, w, h, 0.0, 0.9, DARK, bevel=0.035)
        box('f_console_sc', cx, cy, w * 0.82, h * 0.6, 0.905, 0.925, SCREEN)
        box('f_console_glow', cx, cy, w * 0.86, h * 0.64, 0.88, 0.9, CYAN)
    elif k == 'pillar':
        cyl('f_pillar', cx, cy, min(w, h) * 0.46, 0, 1.3, METAL, verts=16, bevel=0.02)
        cyl('f_pillar_base', cx, cy, min(w, h) * 0.58, 0, 0.10, DARK, verts=16)
    elif k == 'tank':
        cyl('f_tank', cx, cy, min(w, h) * 0.46, 0.1, 1.85, GLASS, verts=20)
        cyl('f_tank_base', cx, cy, min(w, h) * 0.52, 0, 0.1, METAL, verts=20)
        cyl('f_tank_ring1', cx, cy, min(w, h) * 0.49, 0.55, 0.62, METAL, verts=20)
        cyl('f_tank_ring2', cx, cy, min(w, h) * 0.49, 1.30, 1.37, METAL, verts=20)
        ball('f_tank_core', cx, cy, 0.95, min(w, h) * 0.22, LEAF)
    elif k == 'tree':
        cyl('f_tree_trunk', cx, cy, min(w, h) * 0.10, 0, 1.0, WOOD, verts=10)
        ball('f_tree_leaf1', cx, cy, 1.05, min(w, h) * 0.52, LEAF)
        ball('f_tree_leaf2', cx + w * 0.18, cy - h * 0.12, 1.28, min(w, h) * 0.38, LEAF)
        ball('f_tree_leaf3', cx - w * 0.16, cy + h * 0.15, 1.20, min(w, h) * 0.34, LEAF)
    elif k == 'pond':
        box('f_pond', cx, cy, w, h, 0.0, 0.05, WATER)
        box('f_pond_rim', cx, cy, w + 0.2, h + 0.2, 0.0, 0.09, TRIM)
    elif k == 'machine':
        box('f_machine', cx, cy, w, h, 0.0, 1.15, METAL, bevel=0.04)
        box('f_machine_panel', cx, cy - h * 0.30, w * 0.72, h * 0.22, 0.45, 0.8, SCREEN)
        box('f_machine_light', cx, cy + h * 0.32, w * 0.6, h * 0.16, 0.9, 0.95, CYAN)
    elif k == 'crate':
        box('f_crate', cx, cy, w, h, 0.0, 0.85, WOOD, bevel=0.04)
        box('f_crate_band', cx, cy, w * 1.02, h * 0.18, 0.32, 0.40, DARK)
    elif k == 'breaker':
        box('f_breaker', cx, cy, w, h, 0.0, 1.25, DARK, bevel=0.03)
        box('f_breaker_glow', cx, cy - h * 0.52, w * 0.7, 0.05, 0.92, 1.02, RED)
        box('f_breaker_screen', cx, cy, w * 0.55, h * 0.22, 0.55, 0.62, AMBER)
    elif k == 'sofa':
        box('f_sofa', cx, cy, w, h, 0.0, 0.45, FABRIC, bevel=0.06)
        box('f_sofa_back', cx, cy - h / 2 + 0.12, w, 0.24, 0.45, 0.85, FABRIC, bevel=0.05)
        box('f_sofa_arm_l', cx - w / 2 + 0.12, cy, 0.24, h, 0.45, 0.68, FABRIC, bevel=0.05)
        box('f_sofa_arm_r', cx + w / 2 - 0.12, cy, 0.24, h, 0.45, 0.68, FABRIC, bevel=0.05)
    elif k == 'chair':
        box('f_chair', cx, cy, w, h, 0.0, 0.45, FABRIC, bevel=0.05)
        box('f_chair_back', cx, cy - h / 2 + 0.08, w, 0.16, 0.45, 0.92, FABRIC, bevel=0.04)
        cyl('f_chair_pole', cx, cy, 0.05, 0, 0.12, DARK)
    elif k == 'bed':
        box('f_bed', cx, cy, w, h, 0.0, 0.52, WHITE, bevel=0.04)
        box('f_bed_blanket', cx, cy + h * 0.12, w * 0.96, h * 0.72, 0.52, 0.60, BLANKET, bevel=0.03)
        box('f_bed_pillow', cx, cy - h / 2 + 0.35, w * 0.62, 0.42, 0.52, 0.66, WHITE, bevel=0.06)
        box('f_bed_frame', cx, cy, w, h, 0.0, 0.12, METAL, bevel=0.02)
    elif k == 'fridge':
        box('f_fridge', cx, cy, w, h, 0.0, 1.5, WHITE, bevel=0.04)
        box('f_fridge_seam', cx, cy, w * 1.01, h * 0.02, 0.72, 0.74, DARK)
        box('f_fridge_light', cx, cy - h * 0.51, w * 0.5, 0.04, 1.16, 1.22, CYAN)
    elif k == 'rack':
        box('f_rack', cx, cy, w, h, 0.0, 1.45, DARK, bevel=0.03)
        for i in range(4):
            box('f_rack_slot', cx, cy - h * 0.36 + i * h * 0.24, w * 0.72, h * 0.10, 0.22 + i * 0.30, 0.30 + i * 0.30, METAL)
        box('f_rack_light', cx, cy + h * 0.45, w * 0.55, 0.04, 1.25, 1.32, AMBER)
    else:
        box('f_unknown', cx, cy, w, h, 0.0, 0.7, METAL, bevel=0.03)


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
# 每间房一盏吊顶灯：保证暗房也能读出地面材质，同时保留明暗层次
ROOM_LIGHT = {
    'bridge': ((0.78, 0.86, 1.0), 1.00), 'cam': ((0.72, 0.82, 1.0), 0.75),
    'ecosys': ((0.62, 0.95, 0.72), 0.85), 'power': ((0.65, 0.72, 1.0), 0.55),
    'transit': ((0.85, 0.88, 1.0), 0.80), 'fun': ((1.0, 0.80, 0.55), 0.85),
    'engine': ((1.0, 0.55, 0.42), 0.55), 'med': ((0.82, 0.94, 1.0), 1.00),
    'armory': ((1.0, 0.76, 0.45), 0.85),
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
