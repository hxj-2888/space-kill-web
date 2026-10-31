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


def in_poly(poly, x, y):
    """偶奇法：点是否落在舱室多边形内（八边形切角房必须按 poly 判，不能按 rect）。"""
    c, n = False, len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < x1 + (y - y1) / (y2 - y1) * (x2 - x1):
                c = not c
    return c


def room_owner(x, y):
    for r in M['rooms']:
        if in_poly(r['poly'], x, y):
            return r['id']
    return None


def room_by_id(rid):
    return next(r for r in M['rooms'] if r['id'] == rid)

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
scene.view_settings.exposure = 1.34

if not FORCE_CYCLES:
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = eng
            break
        except Exception:
            continue
    try:
        scene.eevee.taa_render_samples = int(argval('--samples', '64'))
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
_IMGS = {}


def load_tex(tex):
    """同一张贴图只上一次显存：变体材质会反复引用同一个 image 数据块。"""
    if tex not in _IMGS:
        _IMGS[tex] = bpy.data.images.load(os.path.join(ROOT, 'assets', 'scene', 'v4', 'tex', tex))
    return _IMGS[tex]


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
    img.image = load_tex(tex)
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
    'bridge': 'floor-carpet.png', 'cam': 'floor-monitor.png', 'ecosys': 'floor-eco.png',
    'power': 'floor-power.png', 'transit': 'cafeteria-floor.png', 'fun': 'floor-lounge.png',
    'engine': 'floor-engine.png', 'med': 'floor-lab.png', 'armory': 'floor-hazard.png',
    'warehouse': 'warehouse-floor.png',
}
FLOOR_SCALE = {'bridge': 1 / 7.5, 'armory': 1 / 3.2, 'med': 1 / 3.0,
               'cam': 1 / 3.0, 'engine': 1 / 3.0, 'warehouse': 1 / 3.2}
FLOOR_TINT = {'armory': (0.72, 0.72, 0.72), 'bridge': (0.46, 0.48, 0.54),
              'cam': (0.86, 0.92, 1.04), 'fun': (0.92, 0.88, 0.98)}
FLOOR_MATS = {}
for rid, tex in TEX.items():
    sc = FLOOR_SCALE.get(rid, 1 / 2.8)
    FLOOR_MATS[rid] = mat_tex('floor_' + rid, tex, scale=(sc, sc, 1), metallic=0.22, rough=0.62,
                              tint=FLOOR_TINT.get(rid))
FLOOR_MATS['corridor'] = mat_tex('floor_corridor', 'floor-grate.png', scale=(1 / 2.6, 1 / 2.6, 1),
                                 metallic=0.42, rough=0.5, emit_mul=0.14,
                                 tint=(0.72, 0.78, 0.9))
# ---------------- 舱室主题 ----------------
# 12° 俯角下，墙面只剩"顶面一条框 + 南侧 0.24 格立面粉片"，所以墙的身份主要靠
# 顶面色（框）与地面标识色（mark）传达；mark 给每间房的地面喷涂/导引线用。
# glow 是墙顶自发光色，让每间房在底图上有一圈不同色的边光。
ROOM_THEME = {
    'bridge':    dict(wall=(1.00, 0.94, 0.86), top=(0.33, 0.30, 0.27), glow=(0.95, 0.62, 0.22), gs=0.42, mark=(0.95, 0.72, 0.28)),
    'cam':       dict(wall=(0.88, 0.96, 1.10), top=(0.24, 0.30, 0.40), glow=(0.16, 0.72, 0.95), gs=0.60, mark=(0.24, 0.78, 0.95)),
    'ecosys':    dict(wall=(0.90, 1.06, 0.92), top=(0.24, 0.33, 0.26), glow=(0.24, 0.85, 0.42), gs=0.50, mark=(0.34, 0.86, 0.44)),
    'power':     dict(wall=(1.02, 0.96, 0.84), top=(0.30, 0.28, 0.23), glow=(0.95, 0.66, 0.16), gs=0.48, mark=(0.96, 0.70, 0.16)),
    'transit':   dict(wall=(1.06, 0.98, 0.88), top=(0.35, 0.30, 0.25), glow=(0.98, 0.76, 0.42), gs=0.40, mark=(0.98, 0.80, 0.45)),
    'fun':       dict(wall=(0.96, 0.90, 1.10), top=(0.29, 0.25, 0.36), glow=(0.86, 0.28, 0.78), gs=0.62, mark=(0.88, 0.32, 0.80)),
    'engine':    dict(wall=(1.10, 0.94, 0.82), top=(0.33, 0.25, 0.20), glow=(0.96, 0.40, 0.18), gs=0.52, mark=(0.96, 0.46, 0.20)),
    'med':       dict(wall=(0.96, 1.00, 1.04), top=(0.44, 0.50, 0.56), glow=(0.42, 0.86, 0.98), gs=0.44, mark=(0.30, 0.82, 0.94)),
    'armory':    dict(wall=(1.04, 0.98, 0.86), top=(0.31, 0.29, 0.24), glow=(0.98, 0.70, 0.20), gs=0.46, mark=(0.98, 0.72, 0.20)),
    'warehouse': dict(wall=(0.98, 1.00, 1.04), top=(0.28, 0.31, 0.36), glow=(0.98, 0.74, 0.24), gs=0.40, mark=(0.98, 0.78, 0.24)),
}
THEME_DEF = dict(wall=(1.0, 1.0, 1.0), top=(0.30, 0.35, 0.42), glow=(0.10, 0.14, 0.18), gs=0.35,
                 mark=(0.60, 0.66, 0.74))


def theme(rid):
    t = dict(THEME_DEF)
    t.update(ROOM_THEME.get(rid, {}))
    return t


WALL = mat_tex('wall', 'wall-panel.png', scale=(1 / 4.0, 1 / 4.0, 1 / 1.18), metallic=0.62, rough=0.38)
WALL_TOP = mat_plain('wall_top', (0.30, 0.35, 0.42), metallic=0.65, rough=0.32,
                     emit=(0.10, 0.14, 0.18), strength=0.35)
# 每间房一套墙面 + 墙顶材质：墙顶是 2.5D 里唯一连续可见的"房间边框"
WALLS, WALL_TOPS = {}, {}
for _rid in ROOM_THEME:
    _t = theme(_rid)
    WALLS[_rid] = mat_tex('wall_' + _rid, 'wall-panel.png', scale=(1 / 4.0, 1 / 4.0, 1 / 1.18),
                          metallic=0.62, rough=0.38, tint=_t['wall'])
    WALL_TOPS[_rid] = mat_plain('wall_top_' + _rid, _t['top'], metallic=0.65, rough=0.32,
                                emit=_t['glow'], strength=_t['gs'])
_LAMP_MATS = {}
_MARK_MATS = {}
TRIM = mat_plain('trim', (0.05, 0.07, 0.09), metallic=0.6, rough=0.6)
CYAN = mat_plain('emit_cyan', (0.06, 0.2, 0.26), metallic=0.2, rough=0.3,
                 emit=(0.12, 0.72, 0.95), strength=5.0)
AMBER = mat_plain('emit_amber', (0.25, 0.18, 0.06), metallic=0.2, rough=0.3,
                  emit=(0.95, 0.62, 0.18), strength=4.0)
RED = mat_plain('emit_red', (0.3, 0.05, 0.04), emit=(0.95, 0.15, 0.1), strength=5.0)
GREEN = mat_plain('emit_green', (0.05, 0.24, 0.08), emit=(0.28, 0.95, 0.36), strength=4.5)
VIOLET = mat_plain('emit_violet', (0.16, 0.05, 0.26), emit=(0.72, 0.30, 0.95), strength=4.5)
# 实例按哈希取一种指示灯配色：原来全船只有青/琥珀两种，机器一多就糊成同一片光
LED_MATS = {'cyan': CYAN, 'amber': AMBER, 'green': GREEN, 'violet': VIOLET, 'red': RED}
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
# ---------------- 实例变体（去复用） ----------------
# 84 件家具原本只由 18 个 kind 生成，同 kind 同尺寸就是完全克隆体
# （货架 3.0×2.0 ×4、培养罐 2.5×3.0 ×4、病床 2.2×2.8 ×3、table 3.0×2.0 ×5）。
# 这里按 `room|label|kind` 的 FNV-1a 哈希给每件家具派生：色调档 / LED 配色 /
# 屏幕分格 / 子部件开关 / 高度 ±10%。哈希是确定性的 —— 同一张地图永远烘出同一张图。
def fnv(s):
    h = 2166136261
    for b in s.encode('utf-8'):
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


TINT_SHIFTS = [(1.00, 1.00, 1.00), (1.09, 1.01, 0.91), (0.91, 1.00, 1.12),
               (1.04, 0.92, 0.99), (0.94, 1.07, 0.97)]
LED_KEYS = ('cyan', 'amber', 'green', 'violet', 'red')


def mat_family(name, tex, scale, metallic, rough, emit_mul, tint, fallback):
    """一张贴图派生 5 档色调，实例按哈希取一档。"""
    return [mat_tex('%s_v%d' % (name, i), tex, scale=scale, metallic=metallic, rough=rough,
                    emit_mul=emit_mul,
                    tint=tuple(tint[j] * TINT_SHIFTS[i][j] for j in range(3)) if tint
                    else TINT_SHIFTS[i],
                    fallback=fallback) for i in range(len(TINT_SHIFTS))]


def variant(c):
    h = fnv('%s|%s|%s' % (c.get('room', ''), c.get('label', ''), c.get('kind', '')))
    return dict(
        tint=(h >> 0) % len(TINT_SHIFTS),
        led=LED_KEYS[(h >> 5) % len(LED_KEYS)],
        segs=3 + (h >> 8) % 3,
        bits=[(h >> (11 + i * 2)) & 3 for i in range(5)],
        hz=0.90 + ((h >> 21) % 21) / 100.0,
        rot=(((h >> 25) % 15) - 7) * math.pi / 180.0,
    )


PANEL_V = mat_family('panel_metal', 'panel-metal.png', (1 / 2.6, 1 / 2.6, 1 / 1.4),
                     0.70, 0.36, 0.26, (0.98, 1.02, 1.10), ((0.13, 0.15, 0.18), 0.72, 0.36))
PANEL_LIGHT_V = mat_family('panel_metal_light', 'panel-metal.png', (1 / 2.2, 1 / 2.2, 1 / 1.2),
                           0.64, 0.42, 0.20, (1.10, 1.14, 1.20), ((0.24, 0.27, 0.31), 0.66, 0.42))
CRATE_V = mat_family('crate_steel', 'crate-steel.png', (1 / 1.9, 1 / 1.9, 1 / 1.0),
                     0.56, 0.52, 0.24, (1.06, 0.98, 0.82), ((0.20, 0.18, 0.15), 0.5, 0.6))
FABRIC_TEX_V = mat_family('fabric_weave', 'fabric-weave.png', (1 / 1.5, 1 / 1.5, 1 / 1.0),
                          0.0, 0.94, 0.08, (0.86, 0.96, 1.06), ((0.10, 0.13, 0.16), 0.0, 0.94))
TOPPLATE_V = mat_family('table_composite', 'table-composite.png', (1 / 3.0, 1 / 3.0, 1.0),
                        0.24, 0.44, 0.16, (0.92, 0.96, 1.04), ((0.10, 0.11, 0.13), 0.24, 0.44))
CAFETERIA_TOP_V = mat_family('cafeteria_top', 'cafeteria-top.png', (1 / 2.4, 1 / 2.4, 1.0),
                             0.20, 0.50, 0.12, (1.02, 0.98, 0.92), ((0.12, 0.12, 0.11), 0.20, 0.50))
WAREHOUSE_RACK_V = mat_family('warehouse_rack', 'warehouse-rack.png', (1 / 2.0, 1 / 2.0, 1.0),
                              0.62, 0.48, 0.16, (1.00, 0.98, 0.92), ((0.16, 0.16, 0.15), 0.62, 0.48))
MEDWHITE_V = mat_family('panel_white', 'panel-white.png', (1 / 2.4, 1 / 2.4, 1 / 1.2),
                        0.16, 0.42, 0.10, (0.96, 0.99, 1.03), ((0.60, 0.66, 0.70), 0.16, 0.42))
HAZ_V = mat_family('hazard_stripe', 'hazard-stripe.png', (1 / 1.1, 1 / 1.1, 1.0),
                   0.18, 0.62, 0.18, (1.05, 0.98, 0.88), ((0.32, 0.20, 0.05), 0.2, 0.6))
PANEL, PANEL_LIGHT, CRATE = PANEL_V[0], PANEL_LIGHT_V[0], CRATE_V[0]
FABRIC_TEX, TOPPLATE, CAFETERIA_TOP = FABRIC_TEX_V[0], TOPPLATE_V[0], CAFETERIA_TOP_V[0]
WAREHOUSE_RACK, MEDWHITE, HAZ = WAREHOUSE_RACK_V[0], MEDWHITE_V[0], HAZ_V[0]
SHADOW = mat_shadow('ao_shadow', 'ao-soft.png', strength=0.62)


# ---------------- 家具细节工具 ----------------
def shadow_decal(tag, cx, cy, w, d, z=0.008, grow=1.0):
    """接地软阴影：把物体"压"进地板，消除贴纸感。"""
    me = bpy.data.meshes.new(tag)
    hw, hd = w * grow / 2, d * grow / 2
    me.from_pydata([(-hw, -hd, z), (hw, -hd, z), (hw, hd, z), (-hw, hd, z)], [], [(0, 1, 2, 3)])
    me.validate()
    recalc(me)
    ob = link(bpy.data.objects.new(tag, me))
    ob.location = (cx, cy, 0)
    ob.rotation_euler = (0, 0, _XF['rot'])
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
# 实例级刚体变换：decor 不参与碰撞（geo.js 只读 M.cover），所以可以整体旋转，
# 用来打破"所有家具都正对坐标轴"的排排坐感。cover 一律 rot=0，保持与
# 游戏里轴对齐的阻挡矩形一致，否则玩家会看见自己踩进箱子的可视化外角。
_XF = {'rot': 0.0, 'cx': 0.0, 'cy': 0.0}


def _tp(x, y):
    r = _XF['rot']
    if not r:
        return x, y
    dx, dy = x - _XF['cx'], y - _XF['cy']
    c, s = math.cos(r), math.sin(r)
    return _XF['cx'] + dx * c - dy * s, _XF['cy'] + dx * s + dy * c


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
    cx, cy = _tp(cx, cy)
    rot = rot + _XF['rot']
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
    x, y = _tp(x, y)
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
    x, y = _tp(x, y)
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
                0.0, 1.16, TRIM, rot=rot, bevel=0.02)
        # 只保留门槛灯：不烘门楣 / 高处灯带，2.5D 里只看得见门的最上面一层，
        # 门板本身由 js/game.js 的 drawDoors() 动态画成顶面薄板。
        lx = cx + (0 if horiz else (-0.27 if side == 'l' else 0.27))
        ly = cy + ((-0.27 if side == 't' else 0.27) if horiz else 0)
        box(tag + '_light', lx, ly,
            1.78 if horiz else 0.06, 0.06 if horiz else 1.78,
            0.024, 0.040, AMBER, rot=rot)

# ---------------- 墙 ----------------
def wall_owner(ax, ay, bx, by):
    """墙段归属哪间房：中点沿法线向两侧探一点，落进谁的 poly 就归谁；都不落 = 走廊墙。"""
    mx, my = (ax + bx) / 2, (ay + by) / 2
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / L, dx / L
    for s in (0.6, -0.6, 1.3, -1.3):
        rid = room_owner(mx + nx * s, my + ny * s)
        if rid:
            return rid, nx * (1 if s > 0 else -1), ny * (1 if s > 0 else -1)
    return None, 0.0, 0.0


wall_i = 0
for seg in M['walls']:
    (ax, ay), (bx, by) = seg
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy)
    if L < 0.05:
        continue
    rot = math.atan2(dy, dx)
    cx, cy = (ax + bx) / 2, (ay + by) / 2
    rid, ox, oy = wall_owner(ax, ay, bx, by)
    wm = WALLS.get(rid, WALL)
    wtm = WALL_TOPS.get(rid, WALL_TOP)
    ob = box('wall_%d' % wall_i, cx, cy, L + 0.12, 0.34, 0.0, 1.16, wm, rot=rot,
             bevel=0.03, mats=[wm, wtm])
    # 墙脚阴影条
    box('wall_trim_%d' % wall_i, cx, cy, L + 0.10, 0.40, 0.0, 0.06, TRIM, rot=rot)
    # 长墙等距挂灯：贴室内一侧，灯色跟本舱主题走（2.5D 里这是房间的"边框光"）
    if L >= 4.0:
        t = theme(rid) if rid else None
        lamp_mat = CYAN
        if t:
            key = 'lamp_%s' % rid
            if key not in _LAMP_MATS:
                _LAMP_MATS[key] = mat_plain(key, (0.06, 0.16, 0.20), metallic=0.2, rough=0.3,
                                            emit=t['glow'], strength=4.2)
            lamp_mat = _LAMP_MATS[key]
        n = max(1, min(6, int(L / 6.5)))
        for i in range(n):
            f = (i + 0.5) / n
            px, py = ax + dx * f, ay + dy * f
            box('wall_lamp_%d_%d' % (wall_i, i), px + ox * 0.19, py + oy * 0.19,
                min(L / n * 0.62, 1.4), 0.05, 0.90, 0.985, lamp_mat, rot=rot)
    wall_i += 1

# ---------------- 家具 ----------------
# 每件家具按 `room|label|kind` 哈希派生实例变体（色调 / 指示灯配色 / 高度 ±10% /
# 子部件开关 / decor 微旋转），并把"名字与形状对不上"的物件拆成专用 kind：
# 手术台不再等于餐桌、街机不再等于呼吸机、枪架不再等于文件柜。
def furniture(c, deco=False):
    x, y, w, h, k = c['x'], c['y'], c['w'], c['h'], c['kind']
    cx, cy = x + w / 2, y + h / 2
    v = variant(c)
    _XF['rot'] = v['rot'] if deco else 0.0
    _XF['cx'], _XF['cy'] = cx, cy
    ti = v['tint']
    bt = v['bits']
    hs = v['hz']
    L = LED_MATS[v['led']]
    PN = PANEL_V[ti]
    PL = PANEL_LIGHT_V[ti]
    CR = CRATE_V[ti]
    FB = FABRIC_TEX_V[ti]
    TP = TOPPLATE_V[ti]
    MW = MEDWHITE_V[ti]
    WR = WAREHOUSE_RACK_V[ti]
    CT = CAFETERIA_TOP_V[ti]
    HZM = HAZ_V[ti]
    tag = 'f_%s_%s' % (k, c.get('label', ''))
    if k not in ('pond', 'plate_stack', 'pot', 'floor_mark'):
        shadow_decal(tag + '_ao', cx, cy, w, h, grow=1.9)

    if k == 'floor_mark':
        # 纯地面喷涂：通道线 / 区域框 / 警戒斜纹 / 十字地标。零高度、零碰撞。
        # 喷涂只是"这块地是干什么的"的暗示，必须压在地板之上一层：emit 0.85 会把它
        # 画成一块荧光漆，整间房被一条白带子抢走（仓库主通道第一次烘出来就是这样）。
        rid = c.get('room')
        if rid not in _MARK_MATS:
            t = theme(rid)
            _MARK_MATS[rid] = mat_plain(
                'mark_' + str(rid),
                (t['mark'][0] * 0.20, t['mark'][1] * 0.20, t['mark'][2] * 0.20),
                metallic=0.1, rough=0.85, emit=t['mark'], strength=0.16)
        mk = _MARK_MATS[rid]
        lb = c.get('label') or ''
        z0, z1 = 0.006, 0.016
        if '警示' in lb or '警戒' in lb:                    # 斜纹警戒带
            n = max(4, int(max(w, h) / 0.9))
            for i in range(n):
                box(tag + '_s%d' % i, cx - w / 2 + (i + 0.5) * w / n, cy,
                    w / n * 0.40, h * 0.92, z0, z1, mk, rot=math.radians(28))
        elif '通道' in lb or lb.endswith('线'):             # 双车道虚线
            for s in (-1, 1):
                if w >= h:
                    box(tag + '_l%d' % s, cx, cy + s * h * 0.28, w, min(0.15, h * 0.15), z0, z1, mk)
                else:
                    box(tag + '_l%d' % s, cx + s * w * 0.28, cy, min(0.15, w * 0.15), h, z0, z1, mk)
        elif '霓虹' in lb or '浇灌' in lb:                  # 十字地标
            box(tag + '_a', cx, cy, w, h * 0.24, z0, z1, mk)
            box(tag + '_b', cx, cy, w * 0.24, h, z0, z1, mk)
        else:                                              # 空心区域框
            bar = 0.11
            box(tag + '_h1', cx, cy - h / 2 + bar / 2, w, bar, z0, z1, mk)
            box(tag + '_h2', cx, cy + h / 2 - bar / 2, w, bar, z0, z1, mk)
            box(tag + '_v1', cx - w / 2 + bar / 2, cy, bar, max(0.12, h - bar * 2), z0, z1, mk)
            box(tag + '_v2', cx + w / 2 - bar / 2, cy, bar, max(0.12, h - bar * 2), z0, z1, mk)
        return

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
        # 桌面全息投影的"内容"：按实例哈希换配色，让每一局的圆桌光色不完全一样
        for i in range(3):
            rr = R * (0.20 + 0.11 * i)
            cyl('f_round_table_holo%d' % i, cx, cy, rr, 0.8458 + i * 0.0012,
                0.8462 + i * 0.0012, L, verts=32)
    elif k in ('table', 'counter'):
        topmat = CT if k == 'counter' else TP
        th = 0.72 * hs
        box(tag + '_top', cx, cy, w, h, th, th + 0.10, topmat, bevel=0.03)
        box(tag + '_rim', cx, cy, w + 0.05, h + 0.05, th - 0.02, th + 0.015, TRIM, bevel=0.02)
        for side in (-1, 1):
            box(tag + '_edge_x', cx, cy + side * (h / 2 - 0.02), w, 0.04, th + 0.08, th + 0.11, L)
            box(tag + '_edge_y', cx + side * (w / 2 - 0.02), cy, 0.04, h, th + 0.08, th + 0.11, L)
        box(tag + '_shelf', cx, cy, w * 0.82, h * 0.66, 0.30, 0.335, DARK)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            lx, ly = cx + sx * (w / 2 - 0.16), cy + sy * (h / 2 - 0.16)
            box(tag + '_leg', lx, ly, 0.10, 0.10, 0.06, th, METAL, bevel=0.015)
            cyl(tag + '_foot', lx, ly, 0.11, 0.0, 0.06, DARK, verts=12)
    elif k == 'servicecounter':
        # 取餐台 / 打包台：台面 + 挡板玻璃 + 收银/扫描立屏 + 台下柜门
        box(tag + '_body', cx, cy, w, h, 0.0, 0.86, PN, bevel=0.03)
        box(tag + '_top', cx, cy, w * 1.04, h * 1.10, 0.86, 0.93, CT, bevel=0.02)
        for i in range(2):
            box(tag + '_door%d' % i, cx + (i - 0.5) * w * 0.46, cy + h * 0.5,
                w * 0.40, 0.05, 0.10, 0.78, PL)
            cyl(tag + '_knob%d' % i, cx + (i - 0.5) * w * 0.46 + w * 0.14, cy + h * 0.5 + 0.04,
                0.03, 0.40, 0.48, METAL, verts=10)
        if bt[1] % 2:                       # 卫生挡板（食堂有、打包台按哈希）
            box(tag + '_guard', cx, cy - h * 0.30, w * 0.96, 0.04, 0.93, 1.42, GLASS)
            box(tag + '_guard_top', cx, cy - h * 0.30, w * 0.98, 0.07, 1.42, 1.46, METAL)
        box(tag + '_pos', cx + w * 0.30, cy, w * 0.20, h * 0.5, 0.93, 1.06, DARK)
        box(tag + '_pos_screen', cx + w * 0.30, cy, w * 0.16, h * 0.4, 1.06, 1.24, SCREEN)
        led_strip(tag + '_led', cx, cy + h * 0.52, w * 0.7, 0.06, L, n=3)
    elif k == 'console':
        # 机柜 + 斜面操作台 + 散热百叶 + 状态灯带 + 地面警戒框
        Z = 0.86 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, PN, bevel=0.035)
        box(tag + '_cap', cx, cy, w * 1.02, h * 1.02, Z, Z + 0.04, PL, bevel=0.02)
        box(tag + '_slope', cx, cy - h * 0.10, w * 0.86, h * 0.42, Z + 0.04, Z + 0.125, SCREEN)
        box(tag + '_slope_trim', cx, cy - h * 0.10, w * 0.92, h * 0.46, Z + 0.025, Z + 0.045, TRIM)
        # 屏幕分格：按实例哈希切成 3~5 条，避免所有控制台都是同一块整屏
        for i in range(v['segs']):
            box(tag + '_seg%d' % i, cx - w * 0.43 + (i + 0.5) * w * 0.86 / v['segs'],
                cy - h * 0.10, w * 0.86 / v['segs'] * 0.10, h * 0.36,
                Z + 0.125, Z + 0.132, DARK if i % 2 else L)
        vent(tag + '_vent', cx, cy + h * 0.30, w * 0.66, h * 0.22, 0.30, n=5)
        led_strip(tag + '_led', cx, cy + h * 0.46, w * 0.7, Z + 0.045, L, n=4)
        bolts(tag + '_bolt', cx, cy, w, h, Z + 0.045, r=0.03, inset=0.10, mat=METAL)
        floor_frame(tag + '_hz', cx, cy, w, h, mat=HZM)
        pipe_run(tag + '_cable', cx, cy + h / 2, cx + w * 0.35, cy + h / 2 + 0.9, 0.05, 0.045, DARK)
    elif k == 'holoscreen':
        # 舱室大屏：落地薄屏 + 边框 + 底座 + 屏面分格（会议室/监控室的身份件）
        Z = 1.62 * hs
        box(tag + '_base', cx, cy, w * 0.9, h * 1.2, 0.0, 0.08, DARK, bevel=0.02)
        box(tag + '_post', cx, cy, w * 0.16, h * 0.8, 0.06, 0.42, METAL)
        box(tag + '_frame', cx, cy, w, h, 0.40, Z, TRIM, bevel=0.02)
        box(tag + '_glass', cx, cy, w * 0.92, h * 0.86, 0.44, Z - 0.04, SCREEN)
        for i in range(v['segs']):
            box(tag + '_line%d' % i, cx, cy - h * 0.34 + i * h * 0.68 / max(1, v['segs'] - 1),
                w * (0.72 - 0.12 * (i % 3)), h * 0.05, Z - 0.035, Z - 0.03, L)
        led_strip(tag + '_led', cx, cy + h * 0.5, w * 0.8, 0.42, L, n=3)
    elif k == 'screenwall':
        # 监控墙：一整面多屏拼接，每屏色相/亮度不同 —— 监控室的唯一身份
        Z = 1.78 * hs
        box(tag + '_frame', cx, cy, w, h, 0.0, Z, DARK, bevel=0.02)
        box(tag + '_foot', cx, cy + h * 0.5, w * 1.02, h * 0.5, 0.0, 0.10, TRIM)
        cols, rows = max(3, int(w / 1.5)), 2
        pw, ph = (w * 0.90) / cols, (h * 0.80) / rows
        for i in range(cols):
            for j in range(rows):
                px = cx - w * 0.45 + (i + 0.5) * pw
                py = cy - h * 0.40 + (j + 0.5) * ph
                m = [SCREEN, CYAN, AMBER, VIOLET][(i * 3 + j * 5 + ti) % 4]
                box(tag + '_m%d_%d' % (i, j), px, py, pw * 0.86, ph * 0.74,
                    0.55 + j * 0.52, 0.58 + j * 0.52 + 0.30, m)
                box(tag + '_bezel%d_%d' % (i, j), px, py, pw * 0.94, ph * 0.84,
                    0.54 + j * 0.52, 0.55 + j * 0.52 + 0.32, TRIM)
        led_strip(tag + '_led', cx, cy + h * 0.52, w * 0.8, 0.12, L, n=4)
    elif k == 'servercab':
        # 机柜列：竖排散热缝 + 一列状态灯 —— 录像归档 / 算力设备
        Z = 1.55 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, PN, bevel=0.03)
        box(tag + '_door', cx, cy - h * 0.5, w * 0.9, 0.05, 0.06, Z - 0.05, DARK)
        for i in range(6):
            z = 0.16 + i * (Z - 0.30) / 5.0
            box(tag + '_u_%d' % i, cx, cy - h * 0.5, w * 0.78, 0.03, z, z + 0.10, PL)
            led_strip(tag + '_st_%d' % i, cx + w * 0.26, cy - h * 0.5 - 0.03,
                      w * 0.20, z + 0.05, AMBER if i % 2 else L, n=2)
        vent(tag + '_vent', cx, cy + h * 0.42, w * 0.7, h * 0.14, Z - 0.14, n=4)
    elif k == 'switchgear':
        # 开关柜排：每格一个断路器手柄 + 表盘 + 三角警示 —— 配电室身份件
        Z = 1.34 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, PN, bevel=0.03)
        box(tag + '_cap', cx, cy, w * 1.02, h * 1.04, Z, Z + 0.05, PL, bevel=0.02)
        n = max(2, int(w / 0.9))
        for i in range(n):
            px = cx - w / 2 + (i + 0.5) * w / n
            box(tag + '_cell%d' % i, px, cy - h * 0.5, w / n * 0.78, 0.04, 0.14, Z - 0.10, DARK)
            box(tag + '_hdl%d' % i, px, cy - h * 0.5 - 0.03, w / n * 0.20, 0.05,
                0.42 + 0.12 * (i % 3), 0.62 + 0.12 * (i % 3), RED if i % 3 == 0 else AMBER)
            cyl(tag + '_dial%d' % i, px, cy - h * 0.5 - 0.03, w / n * 0.16,
                Z - 0.36, Z - 0.30, WHITE, verts=14)
        box(tag + '_warn', cx, cy - h * 0.5 - 0.04, w * 0.20, 0.02, 0.86, 1.06, HZM)
        led_strip(tag + '_led', cx, cy + h * 0.5, w * 0.8, 0.08, L, n=4)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM)
        pipe_run(tag + '_cond', cx, cy + h / 2, cx, cy + h / 2 + 1.1, Z * 0.8, 0.08, DARK)
    elif k == 'transformer':
        # 变压器：铁芯 + 散热片 + 顶部瓷瓶 + 接地铜排
        Z = 1.10 * hs
        box(tag + '_base', cx, cy, w, h, 0.0, 0.16, METAL, bevel=0.02)
        box(tag + '_core', cx, cy, w * 0.86, h * 0.86, 0.16, Z, PN, bevel=0.03)
        for i in range(6):
            box(tag + '_fin%d' % i, cx - w * 0.40 + i * w * 0.16, cy - h * 0.46,
                w * 0.05, h * 0.10, 0.20, Z - 0.04, PL)
        for i in (-1, 0, 1):
            cyl(tag + '_bush%d' % i, cx + i * w * 0.26, cy + h * 0.10, 0.075,
                Z, Z + 0.34, WHITE, verts=12)
            cyl(tag + '_bush_cap%d' % i, cx + i * w * 0.26, cy + h * 0.10, 0.10,
                Z + 0.34, Z + 0.39, METAL, verts=12)
        box(tag + '_plate', cx + w * 0.44, cy, 0.04, h * 0.4, 0.34, 0.62, HZM)
        pipe_run(tag + '_sec', cx, cy + h / 2, cx + w * 0.2, cy + h / 2 + 1.0, 0.10, 0.06, DARK)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM)
    elif k == 'pillar':
        r = min(w, h) * 0.44
        Z = 1.30 * hs
        cyl(tag + '_body', cx, cy, r, 0.10, Z, PL, verts=20, bevel=0.02)
        cyl(tag + '_base', cx, cy, r * 1.22, 0.0, 0.12, DARK, verts=20)
        cyl(tag + '_cap', cx, cy, r * 1.14, Z - 0.02, Z + 0.06, TRIM, verts=20)
        cyl(tag + '_band', cx, cy, r * 1.03, 0.42, 0.56, HZM, verts=20)
        cyl(tag + '_ring', cx, cy, r * 1.05, Z * 0.76, Z * 0.76 + 0.04, L, verts=20)
        box(tag + '_plate', cx + r, cy, 0.10, r * 0.9, 0.62, 0.86, DARK)
    elif k == 'tank':
        r = min(w, h) * 0.44
        lh = 1.42 * hs
        cyl(tag + '_base', cx, cy, r * 1.24, 0.0, 0.14, METAL, verts=24)
        cyl(tag + '_glass', cx, cy, r, 0.14, 1.80, GLASS, verts=24, bevel=0.02)
        cyl(tag + '_liquid', cx, cy, r * 0.9, 0.20, lh, WATER, verts=24)
        cyl(tag + '_ring1', cx, cy, r * 1.06, 0.52, 0.62, METAL, verts=24)
        cyl(tag + '_ring2', cx, cy, r * 1.06, 1.28, 1.38, METAL, verts=24)
        cyl(tag + '_cap', cx, cy, r * 1.12, 1.80, 1.92, PL, verts=24, bevel=0.02)
        cyl(tag + '_cap_led', cx, cy, r * 0.5, 1.92, 1.95, L, verts=20)
        # 罐内植株：每个罐子株型/色相不同（原来四个罐是完全相同的克隆体）
        for i in range(3 + bt[2] % 3):
            a = math.pi * 2 * i / (3 + bt[2] % 3) + bt[3]
            rr = r * (0.16 + 0.20 * ((i + bt[4]) % 3) / 2.0)
            ball(tag + '_pl%d' % i, cx + math.cos(a) * r * 0.34, cy + math.sin(a) * r * 0.34,
                 0.52 + i * 0.16, rr, [LEAF, WATER, GLASS][(i + ti) % 3], subdiv=1)
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
    elif k in ('reactor', 'engineblock'):
        # 引擎组 = 反应堆核心（发光环 + 环抱管束 + 排气塔）；缸体 = 带散热筋的机体
        Z = (1.72 if k == 'reactor' else 1.24) * hs
        box(tag + '_pad', cx, cy, w * 1.06, h * 1.06, 0.0, 0.10, DARK, bevel=0.02)
        if k == 'reactor':
            R = min(w, h) * 0.34
            cyl(tag + '_core', cx, cy, R, 0.10, Z, PN, verts=28, bevel=0.03)
            cyl(tag + '_glow', cx, cy, R * 1.02, Z * 0.34, Z * 0.62, L, verts=28)
            cyl(tag + '_cap', cx, cy, R * 1.16, Z, Z + 0.12, PL, verts=28, bevel=0.02)
            cyl(tag + '_vent', cx, cy, R * 0.44, Z + 0.12, Z + 0.46, METAL, verts=18)
            for i in range(6):
                a = math.pi * 2 * i / 6
                px, py = cx + math.cos(a) * R * 1.9, cy + math.sin(a) * R * 1.9
                cyl(tag + '_col%d' % i, px, py, 0.11, 0.10, Z * 0.86, METAL, verts=12)
                pipe_run(tag + '_pipe%d' % i, px, py, cx + math.cos(a) * R * 1.02,
                         cy + math.sin(a) * R * 1.02, Z * 0.80, 0.075, DARK)
                ball(tag + '_flange%d' % i, px, py, Z * 0.86, 0.14, PL, subdiv=1)
            for i in range(3):
                cyl(tag + '_ring%d' % i, cx, cy, R * 1.20, 0.30 + i * 0.42, 0.36 + i * 0.42,
                    HZM if i % 2 else METAL, verts=26)
        else:
            box(tag + '_body', cx, cy, w * 0.92, h * 0.86, 0.10, Z, PN, bevel=0.04)
            for i in range(5):
                box(tag + '_head%d' % i, cx - w * 0.34 + i * w * 0.17, cy,
                    w * 0.12, h * 0.88, Z, Z + 0.16, PL, bevel=0.02)
                cyl(tag + '_stack%d' % i, cx - w * 0.34 + i * w * 0.17, cy - h * 0.20,
                    0.07, Z + 0.16, Z + 0.52 + 0.08 * (i % 3), METAL, verts=12)
            for i in range(6):
                box(tag + '_fin%d' % i, cx - w * 0.42 + i * w * 0.17, cy + h * 0.44,
                    w * 0.05, h * 0.12, 0.18, Z - 0.06, DARK)
            pipe_run(tag + '_fuel', cx - w * 0.5, cy - h * 0.3, cx + w * 0.5, cy - h * 0.3,
                     Z * 0.55, 0.06, METAL)
        led_strip(tag + '_led', cx, cy + h * 0.54, w * 0.6, 0.12, L, n=3)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM)
    elif k == 'machine':
        # 主体 + 顶盖 + 前屏 + 灯带 + 散热 + 管线 + 地面警戒框：让方块读成"一台设备"
        Z = 1.06 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, PN, bevel=0.05)
        box(tag + '_cap', cx, cy, w * 0.94, h * 0.94, Z, Z + 0.08, PL, bevel=0.03)
        box(tag + '_cap_in', cx, cy, w * 0.6, h * 0.6, Z + 0.08, Z + 0.10, DARK)
        box(tag + '_panel', cx, cy - h * 0.30, w * 0.70, h * 0.20, Z * 0.40, Z * 0.76, SCREEN)
        box(tag + '_panel_trim', cx, cy - h * 0.30, w * 0.76, h * 0.24, Z * 0.38, Z * 0.40, TRIM)
        for i in range(v['segs']):
            box(tag + '_bar%d' % i, cx - w * 0.30 + i * w * 0.20, cy - h * 0.30,
                w * 0.10, h * 0.10, Z * 0.76, Z * 0.765, L)
        led_strip(tag + '_led', cx, cy + h * 0.34, w * 0.62, Z - 0.16, L, n=4)
        vent(tag + '_vent', cx - w * 0.32, cy, h * 0.5, w * 0.22, 0.24, n=6)
        box(tag + '_haz', cx, cy + h * 0.5, w * 1.01, h * 0.08, 0.16, 0.30, HZM)
        if bt[0] % 2:
            cyl(tag + '_stack', cx + w * 0.30, cy + h * 0.22, min(w, h) * 0.12,
                Z + 0.08, Z + 0.46, METAL, verts=14)
            cyl(tag + '_stack_cap', cx + w * 0.30, cy + h * 0.22, min(w, h) * 0.15,
                Z + 0.44, Z + 0.50, DARK, verts=14)
        if bt[1] % 2:
            box(tag + '_drawer', cx - w * 0.26, cy + h * 0.44, w * 0.34, h * 0.12,
                0.22, 0.40, PL)
        pipe_run(tag + '_pipe', cx - w * 0.45, cy + h * 0.35, cx + w * 0.30, cy + h * 0.22,
                 Z + 0.14, 0.055)
        bolts(tag + '_bolt', cx, cy, w, h, Z + 0.08, r=0.035, inset=0.14, mat=METAL)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM)
    elif k == 'arcade':
        # 街机柜：顶灯箱 + 斜屏 + 摇杆按钮台 + 投币口 —— 娱乐室的招牌剪影
        Z = 1.66 * hs
        box(tag + '_cab', cx, cy, w, h, 0.0, Z * 0.72, PN, bevel=0.04)
        box(tag + '_cheek', cx, cy - h * 0.34, w * 1.02, h * 0.40, Z * 0.30, Z * 0.62, PL)
        box(tag + '_screen', cx, cy - h * 0.20, w * 0.78, h * 0.34, Z * 0.44, Z * 0.72, SCREEN,
            rot=-0.30)
        box(tag + '_marquee', cx, cy - h * 0.42, w * 1.04, h * 0.30, Z * 0.72, Z,
            [CYAN, AMBER, VIOLET, L][ti % 4], bevel=0.02)
        box(tag + '_marquee_top', cx, cy - h * 0.42, w * 1.06, h * 0.32, Z, Z + 0.05, TRIM)
        box(tag + '_deck', cx, cy + h * 0.10, w * 0.98, h * 0.34, Z * 0.30, Z * 0.36, DARK)
        cyl(tag + '_stick', cx - w * 0.20, cy + h * 0.10, 0.035, Z * 0.36, Z * 0.52, RED, verts=10)
        ball(tag + '_ball', cx - w * 0.20, cy + h * 0.10, Z * 0.54, 0.06, RED, subdiv=1)
        for i in range(4):
            cyl(tag + '_btn%d' % i, cx + w * (0.02 + 0.11 * (i % 2)), cy + h * (0.04 + 0.10 * (i // 2)),
                0.045, Z * 0.36, Z * 0.40, [CYAN, AMBER, VIOLET, GREEN][i % 4], verts=12)
        box(tag + '_coin', cx + w * 0.32, cy + h * 0.30, w * 0.16, 0.04, 0.30, 0.52, METAL)
        led_strip(tag + '_led', cx, cy + h * 0.52, w * 0.8, 0.06, L, n=3)
    elif k == 'jukebox':
        # 点唱机：圆顶灯罩 + 正面玻璃格 + 选曲面板
        Z = 1.24 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z * 0.66, WOOD, bevel=0.05)
        cyl(tag + '_dome', cx, cy, min(w, h) * 0.46, Z * 0.66, Z,
            [VIOLET, CYAN, AMBER][ti % 3], verts=20, bevel=0.03)
        box(tag + '_glass', cx, cy - h * 0.5, w * 0.78, 0.05, Z * 0.20, Z * 0.60, GLASS)
        for i in range(4):
            box(tag + '_row%d' % i, cx, cy - h * 0.5 - 0.03, w * 0.66, 0.02,
                Z * 0.26 + i * Z * 0.08, Z * 0.28 + i * Z * 0.08,
                [CYAN, AMBER, VIOLET, GREEN][i % 4])
        box(tag + '_panel', cx, cy + h * 0.20, w * 0.7, h * 0.4, Z * 0.62, Z * 0.66, DARK)
    elif k == 'billiard':
        # 台球桌：木框 + 绿呢台面 + 六袋 + 彩球
        Z = 0.80 * hs
        box(tag + '_frame', cx, cy, w, h, 0.20, Z, WOOD, bevel=0.04)
        box(tag + '_felt', cx, cy, w * 0.84, h * 0.74, Z, Z + 0.03, LEAF)
        for sx in (-1, 1):
            for sy in (-1, 1):
                cyl(tag + '_leg_%d%d' % (sx, sy), cx + sx * (w / 2 - 0.14), cy + sy * (h / 2 - 0.14),
                    0.07, 0.0, 0.20, WOOD, verts=10)
        for i, (px, py) in enumerate(((-w / 2, 0), (w / 2, 0),
                                      (-w * 0.24, -h / 2), (w * 0.24, -h / 2),
                                      (-w * 0.24, h / 2), (w * 0.24, h / 2))):
            cyl(tag + '_pocket%d' % i, cx + px, cy + py, min(w, h) * 0.09, Z - 0.01, Z + 0.035, DARK, verts=14)
        for i in range(6):
            a = math.pi * 2 * i / 6
            ball(tag + '_ball%d' % i, cx + w * 0.22 + math.cos(a) * 0.09,
                 cy + math.sin(a) * 0.09, Z + 0.075, 0.045,
                 [RED, AMBER, CYAN, VIOLET, GREEN, WHITE][i % 6], subdiv=1)
        ball(tag + '_cue', cx - w * 0.10, cy, Z + 0.075, 0.045, WHITE, subdiv=1)
        led_strip(tag + '_rail', cx, cy - h * 0.5, w * 0.5, Z - 0.06, AMBER, n=3)
    elif k == 'crate':
        # 钢板货箱：框筋 + 警戒色带 + 顶盖缝 + 锁扣，替换原来的纯色木盒
        Z = 0.84 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, CR, bevel=0.045)
        box(tag + '_lid', cx, cy, w * 0.96, h * 0.96, Z, Z + 0.06, PL, bevel=0.025)
        box(tag + '_seam', cx, cy, w * 1.005, h * 1.005, Z - 0.025, Z - 0.005, DARK)
        for sx in (-1, 1):
            box(tag + '_post_l%d' % sx, cx + sx * (w / 2 - 0.06), cy, 0.12, h * 1.01, 0.0, Z + 0.04, DARK)
            box(tag + '_post_w%d' % sx, cx, cy + sx * (h / 2 - 0.06), w * 1.01, 0.12, 0.0, Z + 0.04, DARK)
        box(tag + '_band', cx, cy, w * 1.02, h * 0.20, 0.34, 0.42, HZM)
        box(tag + '_latch', cx + w * 0.30, cy - h * 0.5, w * 0.18, 0.07, 0.44, 0.62, METAL)
        box(tag + '_plate', cx - w * 0.22, cy - h * 0.5, w * 0.30, 0.05, 0.50, 0.68, WHITE)
        if bt[0] % 2:                       # 半开箱盖：有的箱子是开着的
            box(tag + '_openlid', cx, cy - h * 0.52, w * 0.94, h * 0.30, Z + 0.05, Z + 0.10, PL,
                rot=-0.5)
        if bt[2] % 2:                       # 顶上一件小货：打破"齐平顶盖"
            box(tag + '_mini', cx - w * 0.18, cy + h * 0.16, w * 0.34, h * 0.34,
                Z + 0.06, Z + 0.06 + h * 0.22, CRATE_V[(ti + 2) % 5], bevel=0.03)
        bolts(tag + '_bolt', cx, cy, w, h, Z + 0.06, r=0.03, inset=0.13, mat=METAL)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM, bar=0.10, gap=0.16)
    elif k == 'pallet':
        # 托盘 + 缠绕膜货堆：仓库不该只有"箱子"，托盘才读得出物流感
        box(tag + '_pallet', cx, cy, w, h, 0.0, 0.09, WOOD, bevel=0.01)
        for i in range(4):
            box(tag + '_slat%d' % i, cx - w * 0.36 + i * w * 0.24, cy, w * 0.06, h * 0.98,
                0.0, 0.07, DARK)
        n = 2 + bt[0] % 3
        for i in range(n):
            bw = w * (0.62 - 0.10 * (i % 2))
            bd = h * (0.62 - 0.08 * ((i + 1) % 2))
            z0 = 0.09 + i * 0.26
            box(tag + '_box%d' % i, cx + (0.06 if i % 2 else -0.06), cy + (0.04 if i % 3 == 0 else -0.03),
                bw, bd, z0, z0 + 0.24, CRATE_V[(ti + i) % 5], bevel=0.03)
            box(tag + '_wrap%d' % i, cx + (0.06 if i % 2 else -0.06), cy + (0.04 if i % 3 == 0 else -0.03),
                bw * 1.01, bd * 1.01, z0 + 0.08, z0 + 0.12, GLASS)
        box(tag + '_tag', cx + w * 0.44, cy - h * 0.30, 0.03, h * 0.22, 0.10, 0.34, WHITE)
        led_strip(tag + '_led', cx, cy + h * 0.52, w * 0.4, 0.095, AMBER, n=2)
    elif k == 'forklift':
        # 叉车：车体 + 门架 + 落地货叉 + 顶护架
        box(tag + '_body', cx, cy, w * 0.56, h * 0.92, 0.14, 0.72, PN, bevel=0.04)
        box(tag + '_cab', cx - w * 0.04, cy, w * 0.40, h * 0.72, 0.72, 1.16, GLASS)
        box(tag + '_guard', cx - w * 0.04, cy, w * 0.46, h * 0.78, 1.16, 1.21, METAL)
        box(tag + '_mast', cx + w * 0.30, cy - h * 0.10, 0.10, h * 0.62, 0.0, 1.28, METAL)
        for sy in (-1, 1):
            box(tag + '_fork%d' % sy, cx + w * 0.44, cy + sy * h * 0.22,
                w * 0.34, h * 0.14, 0.0, 0.055, DARK)
        for sx in (-1, 1):
            for sy in (-1, 1):
                cyl(tag + '_wh_%d%d' % (sx, sy), cx + sx * w * 0.22, cy + sy * h * 0.38,
                    0.13 if sx < 0 else 0.10, 0.0, 0.06 if sx < 0 else 0.20, TRIM, verts=14)
        led_strip(tag + '_beacon', cx - w * 0.04, cy - h * 0.30, w * 0.16, 1.21, AMBER, n=1)
    elif k == 'breaker':
        Z = 1.22 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, PN, bevel=0.035)
        box(tag + '_door', cx, cy - h * 0.5, w * 0.92, 0.06, 0.22, Z - 0.12, PL)
        box(tag + '_screen', cx, cy - h * 0.5, w * 0.55, 0.05, Z * 0.70, Z * 0.84, AMBER)
        box(tag + '_haz', cx, cy, w * 1.01, h * 1.01, 0.14, 0.26, HZM)
        box(tag + '_lever', cx + w * 0.22, cy - h * 0.52, 0.09, 0.09, 0.42, 0.72, RED)
        cyl(tag + '_knob', cx + w * 0.22, cy - h * 0.56, 0.075, 0.70, 0.76, METAL, verts=12)
        led_strip(tag + '_led', cx, cy + h * 0.5, w * 0.6, Z, CYAN, n=3)
        pipe_run(tag + '_cond', cx, cy + h / 2, cx, cy + h / 2 + 1.2, Z * 0.86, 0.07, DARK)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM)
    elif k == 'sofa':
        box(tag + '_base', cx, cy, w, h, 0.10, 0.42, FB, bevel=0.06)
        box(tag + '_back', cx, cy - h / 2 + 0.11, w, 0.22, 0.42, 0.86, FB, bevel=0.05)
        box(tag + '_arm_l', cx - w / 2 + 0.11, cy, 0.22, h, 0.42, 0.66, FB, bevel=0.05)
        box(tag + '_arm_r', cx + w / 2 - 0.11, cy, 0.22, h, 0.42, 0.66, FB, bevel=0.05)
        for i, sx in enumerate((-1, 1)):
            box(tag + '_cush%d' % i, cx + sx * w * 0.22, cy + 0.03, w * 0.40, h * 0.72,
                0.42, 0.52, FABRIC_TEX_V[(ti + 1) % 5], bevel=0.04)
        for li, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            cyl(tag + '_leg%d' % li, cx + sx * (w / 2 - 0.14), cy + sy * (h / 2 - 0.14),
                0.045, 0.0, 0.11, METAL, verts=8)
    elif k == 'chair':
        box(tag + '_seat', cx, cy, w, h, 0.36, 0.48, FB, bevel=0.05)
        box(tag + '_back', cx, cy - h / 2 + 0.07, w * 0.94, 0.14, 0.48, 0.94, FB, bevel=0.04)
        box(tag + '_back_post', cx, cy - h / 2 + 0.07, 0.07, 0.07, 0.44, 0.52, DARK)
        cyl(tag + '_pole', cx, cy, 0.05, 0.12, 0.36, DARK, verts=10)
        for i in range(5):
            a = math.pi * 2 * i / 5
            box(tag + '_arm%d' % i, cx + math.cos(a) * 0.16, cy + math.sin(a) * 0.16,
                0.30, 0.05, 0.06, 0.12, DARK, rot=a)
            cyl(tag + '_cast%d' % i, cx + math.cos(a) * 0.28, cy + math.sin(a) * 0.28,
                0.035, 0.0, 0.07, METAL, verts=8)
    elif k in ('bed', 'medbed'):
        # 病床：床架 + 床垫 + 被褥 + 床头屏 + 护栏；medbed 再加输液杆与心电监护
        box(tag + '_frame', cx, cy, w, h, 0.0, 0.14, METAL, bevel=0.02)
        box(tag + '_body', cx, cy, w * 0.98, h * 0.98, 0.40, 0.52, MW, bevel=0.04)
        box(tag + '_mattress', cx, cy, w * 0.92, h * 0.94, 0.52, 0.62, WHITE, bevel=0.05)
        box(tag + '_blanket', cx, cy + h * 0.14, w * 0.94, h * 0.66, 0.60, 0.665,
            FABRIC_TEX_V[(ti + 3) % 5], bevel=0.03)
        box(tag + '_blanket_fold', cx, cy - h * 0.16, w * 0.94, h * 0.08, 0.62, 0.68, FB, bevel=0.02)
        box(tag + '_pillow', cx, cy - h / 2 + 0.32, w * 0.58, 0.40, 0.62, 0.74, WHITE, bevel=0.07)
        for sx in (-1, 1):
            box(tag + '_rail%d' % sx, cx + sx * (w / 2 - 0.05), cy + h * 0.10, 0.05, h * 0.42,
                0.52, 0.80, METAL, bevel=0.015)
        box(tag + '_pad', cx, cy, w * 1.35, h * 1.18, 0.005, 0.012, MW)
        if k == 'medbed':
            cyl(tag + '_pole', cx - w * 0.42, cy - h * 0.42, 0.035, 0.14, 1.34, METAL, verts=10)
            box(tag + '_monitor', cx - w * 0.42, cy - h * 0.42, 0.34, 0.07, 1.10, 1.32, SCREEN)
            for i in range(3):
                box(tag + '_trace%d' % i, cx - w * 0.42 - 0.10 + i * 0.10, cy - h * 0.42 - 0.04,
                    0.05, 0.02, 1.33, 1.335, GREEN if i % 2 else CYAN)
            if bt[3] % 2:
                cyl(tag + '_ivpole', cx + w * 0.44, cy - h * 0.30, 0.028, 0.14, 1.52, METAL, verts=8)
                box(tag + '_ivbag', cx + w * 0.44, cy - h * 0.30, 0.16, 0.09, 1.30, 1.50, GLASS)
            box(tag + '_tag', cx, cy + h * 0.56, w * 0.30, 0.03, 0.52, 0.70, WHITE)
    elif k == 'ventilator':
        # 呼吸机：立式机箱 + 圆形风机窗 + 呼吸管路 + 数值屏
        Z = 1.18 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, MW, bevel=0.04)
        cyl(tag + '_fan', cx, cy - h * 0.42, min(w, h) * 0.34, Z * 0.42, Z * 0.86, SCREEN, verts=18)
        cyl(tag + '_fan_ring', cx, cy - h * 0.42, min(w, h) * 0.38, Z * 0.40, Z * 0.44, METAL, verts=18)
        box(tag + '_disp', cx, cy + h * 0.30, w * 0.86, h * 0.30, Z - 0.20, Z - 0.02, SCREEN)
        led_strip(tag + '_bar', cx, cy + h * 0.52, w * 0.7, Z, GREEN, n=3)
        pipe_run(tag + '_tube', cx - w * 0.4, cy - h * 0.2, cx + w * 0.9, cy - h * 0.9,
                 Z * 0.60, 0.05, GLASS)
        for i in (-1, 1):
            cyl(tag + '_wh%d' % i, cx + i * w * 0.34, cy + h * 0.40, 0.06, 0.0, 0.10, DARK, verts=10)
    elif k == 'ivstand':
        cyl(tag + '_base', cx, cy, min(w, h) * 0.42, 0.0, 0.035, DARK, verts=14)
        cyl(tag + '_pole', cx, cy, 0.035, 0.03, 1.72, METAL, verts=10)
        for i in (-1, 1):
            box(tag + '_hook%d' % i, cx + i * 0.16, cy, 0.20, 0.035, 1.60, 1.66, METAL)
            box(tag + '_bag%d' % i, cx + i * 0.24, cy, 0.13, 0.09, 1.34, 1.58, GLASS)
    elif k == 'fridge':
        Z = 1.46 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, MW, bevel=0.045)
        box(tag + '_top', cx, cy, w * 1.01, h * 1.01, Z, Z + 0.04, PL, bevel=0.02)
        box(tag + '_seam', cx, cy, w * 1.015, h * 0.022, 0.70, 0.735, DARK)
        box(tag + '_seam_v', cx, cy, w * 0.022, h * 1.015, 0.02, Z - 0.02, DARK)
        for sx in (-1, 1):
            box(tag + '_handle%d' % sx, cx + sx * w * 0.18, cy - h * 0.5, 0.05, 0.05,
                0.86, 1.12, METAL)
        box(tag + '_label', cx - w * 0.20, cy - h * 0.5, w * 0.30, 0.04, 1.16, 1.30, L)
        vent(tag + '_vent', cx, cy + h * 0.5, w * 0.66, h * 0.16, Z - 0.22, n=4)
        led_strip(tag + '_led', cx, cy - h * 0.5, w * 0.5, 0.05, CYAN, n=3)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM, bar=0.10, gap=0.16)
    elif k in ('rack', 'gunrack', 'warehouse_rack', 'shelftall'):
        tall = k in ('warehouse_rack', 'shelftall')
        side_mat = WR if tall else PN
        Z = (2.05 if k == 'shelftall' else 1.46) * hs
        box(tag + '_frame', cx, cy, w, h, 0.0, Z, DARK, bevel=0.03)
        for sx in (-1, 1):
            box(tag + '_side%d' % sx, cx + sx * (w / 2 - 0.04), cy, 0.08, h * 1.01, 0.02, Z, side_mat)
        if k == 'gunrack':
            # 枪架：竖格分隔 + 斜靠的长枪轮廓 + 格前琥珀标牌
            n = max(3, int(w / 0.55))
            for i in range(n):
                px = cx - w / 2 + (i + 0.5) * w / n
                box(tag + '_div%d' % i, px, cy, 0.035, h * 0.92, 0.10, Z - 0.06, METAL)
                if (i + bt[0]) % 3 != 0:
                    box(tag + '_rifle%d' % i, px, cy - h * 0.06, w / n * 0.30, h * 0.80,
                        0.22, 0.30, TRIM, rot=0.14)
                    box(tag + '_stock%d' % i, px, cy + h * 0.30, w / n * 0.42, h * 0.24,
                        0.20, 0.34, WOOD)
                box(tag + '_tag%d' % i, px, cy - h * 0.52, w / n * 0.5, 0.03, Z - 0.30, Z - 0.20,
                    AMBER if i % 2 else L)
            box(tag + '_cap', cx, cy, w * 1.02, h * 1.02, Z, Z + 0.06, TRIM, bevel=0.02)
        else:
            for i in range(4):
                z = 0.22 + i * (Z - 0.42) / 3.0
                box(tag + '_slot%d' % i, cx, cy - h * 0.36 + i * h * 0.24, w * 0.74, h * 0.10,
                    z, z + 0.09, PL, bevel=0.01)
                led_strip(tag + '_slot_led%d' % i, cx + w * 0.22, cy - h * 0.36 + i * h * 0.24,
                          w * 0.22, z + 0.09, AMBER if i % 2 else L, n=2)
                if tall and (i + bt[1]) % 3 != 0:
                    # 高层货架每层摆不同数量的货箱：四组货架从此不再是四胞胎
                    for j in range(1 + (bt[2] + i) % 3):
                        bw = w * 0.26
                        box(tag + '_cargo%d_%d' % (i, j), cx - w * 0.24 + j * w * 0.28,
                            cy + h * 0.04, bw, h * 0.52, z + 0.09, z + 0.09 + 0.30,
                            CRATE_V[(ti + i + j) % 5], bevel=0.02)
            box(tag + '_cap', cx, cy, w * 1.02, h * 1.02, Z, Z + 0.06, TRIM, bevel=0.02)
            if tall:
                for sx in (-1, 1):
                    box(tag + '_beam%d' % sx, cx, cy + sx * h * 0.5, w * 1.04, 0.09,
                        Z - 0.16, Z - 0.06, WR)
                led_strip(tag + '_top', cx, cy - h * 0.52, w * 0.7, Z - 0.10, AMBER, n=3)
        vent(tag + '_vent', cx, cy + h * 0.44, w * 0.6, h * 0.12, Z - 0.16, n=4)
        pipe_run(tag + '_cable', cx, cy + h / 2, cx - w * 0.4, cy + h / 2 + 1.0, 0.06, 0.05, DARK)
        floor_frame(tag + '_hzf', cx, cy, w, h, mat=HZM, bar=0.10, gap=0.16)
    elif k == 'plate_stack':
        for i, rr in enumerate((0.34, 0.30, 0.26)):
            cyl(tag + '_plate%d' % i, cx, cy, rr, 0.84 + i * 0.025, 0.855 + i * 0.025,
                WHITE, verts=24, bevel=0.008)
        cyl(tag + '_rim', cx, cy, 0.38, 0.838, 0.846, METAL, verts=24)
    elif k == 'pot':
        cyl(tag + '_body', cx, cy, min(w, h) * 0.32, 0.84, 1.08, PL, verts=20)
        cyl(tag + '_lid', cx, cy, min(w, h) * 0.33, 1.08, 1.12, METAL, verts=20)
        cyl(tag + '_knob', cx, cy, min(w, h) * 0.07, 1.12, 1.20, L, verts=12)
        led_strip(tag + '_led', cx, cy + min(w, h) * 0.30, min(w, h) * 0.34, 0.94, AMBER, n=2)
    else:
        Z = 0.70 * hs
        box(tag + '_body', cx, cy, w, h, 0.0, Z, PN, bevel=0.03)
        box(tag + '_cap', cx, cy, w * 0.96, h * 0.96, Z, Z + 0.04, PL, bevel=0.02)
    _XF['rot'] = 0.0


for c in M['cover']:
    furniture(c)
for c in M.get('decor', []):
    furniture(c, deco=True)

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
    'bridge': ((0.78, 0.86, 1.0), 1.00), 'cam': ((0.72, 0.82, 1.0), 1.00),
    'ecosys': ((0.62, 0.95, 0.72), 0.90), 'power': ((0.68, 0.76, 1.0), 0.92),
    'transit': ((1.0, 0.88, 0.74), 0.92), 'fun': ((1.0, 0.80, 0.55), 0.88),
    'engine': ((1.0, 0.66, 0.50), 0.95), 'med': ((0.82, 0.94, 1.0), 1.00),
    'armory': ((1.0, 0.76, 0.45), 0.90), 'warehouse': ((0.88, 0.94, 1.0), 0.95),
}
# 一间房一盏吊顶灯时，灯幅 max(6, min(rw,rh)*1.3) 只盖得住房间短边那一横条：
# 仓库 42×12 的灯只覆盖 x∈33..49，会议室八边形的两个尖角整个在灯外 —— 这就是
# "舱室边缘是黑的"的根因（实测仓库边缘亮度 34.7、41% 面积低于 30）。
# 改成"高空泛光 + 9 格网格布灯"：泛光保证无死区，网格负责近处细节与材质可读性。
CELL_LIGHT = float(argval('--cell', '9.0'))
BRIGHT_MUL = float(argval('--bright', '1.22'))   # 亮舱整体提亮
# 暗舱只轻压：游戏里还要再叠 0.55 压暗，所以烘焙必须保持"掩体在手电锥里读得出来"
# （AGENTS 既有约定）。0.88 实测让引擎/配电的暗面占比涨到 38%/34%，1.15 回到 9%/10%。
DARK_MUL = float(argval('--dark', '1.15'))
# 房间灯总能量增益。泛光盘从"一盏近灯"拆成"高空盘 + 近地面网格"后，
# 盘那一档在 9.5 格高上基本落不到地板，实测整船均值掉了约 19%（63.2→51.7）；
# 1.6 是扫值标定的结果：中心 79.6 / 边缘 61.3 / P05 23.9 / 暗面 10.9%，
# 四个指标全面优于旧版单灯（74.6 / 53.3 / 10.9 / 17.6%）。再高（2.2）开始发灰。
LIGHT_GAIN = float(argval('--lum', '1.6'))
for r in M['rooms']:
    x0, y0, rw, rh = r['rect']
    col, mul = ROOM_LIGHT.get(r['id'], ((1, 1, 1), 0.8))
    mul *= BRIGHT_MUL if r.get('light') == 'bright' else DARK_MUL
    total = (90 + r['area'] * 1.7) * mul * LIGHT_GAIN
    area('roomwash_' + r['id'], x0 + rw / 2, y0 + rh / 2, 9.5,
         max(rw, rh) * 1.45, total * 0.34, col, shape='DISK')
    nx, ny = max(1, round(rw / CELL_LIGHT)), max(1, round(rh / CELL_LIGHT))
    cells = [(i, j) for i in range(nx) for j in range(ny)
             if in_poly(r['poly'], x0 + (i + .5) / nx * rw, y0 + (j + .5) / ny * rh)]
    if not cells:
        cells = [(nx // 2, ny // 2)]
    e = total * 0.66 / len(cells)
    for i, j in cells:
        area('room_%s_%d%d' % (r['id'], i, j), x0 + (i + .5) / nx * rw, y0 + (j + .5) / ny * rh,
             4.4, max(6.0, min(rw / nx, rh / ny) * 1.7), e, col)

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
# Blender 5.x 的合成器已改为 node group（scene.compositing_node_group）；
# 4.x 仍然是 scene.node_tree + CompositorNodeComposite，两条路都要能跑。
scene.use_nodes = True
if hasattr(scene, 'compositing_node_group'):
    nt = bpy.data.node_groups.new('ShipComp', 'CompositorNodeTree')
    scene.compositing_node_group = nt
    nt.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    go = nt.nodes.new('NodeGroupOutput')
    out_socket = go.inputs[0]
else:
    nt = scene.node_tree
    nt.nodes.clear()
    go = nt.nodes.new('CompositorNodeComposite')
    out_socket = go.inputs['Image']
rl = nt.nodes.new('CompositorNodeRLayers')
flip = nt.nodes.new('CompositorNodeFlip')
flip.inputs['Flip Y'].default_value = True
nt.links.new(rl.outputs['Image'], flip.inputs['Image'])
nt.links.new(flip.outputs['Image'], out_socket)

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
