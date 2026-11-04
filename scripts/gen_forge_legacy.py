# Genera eris-mobile/src/services/forge/forgeLegacy.ts: la lógica del RPG de toji.html, portada TAL CUAL (Forge 2.0, F1).
# Cambios mecánicos y nada más:
#   - íconos (Dumbbell…) → su nombre en texto (la pantalla nativa dibuja el suyo);
#   - window.__ERIS_X__ → forgeEnv (lo llena el store con lo mismo que TojiScreen inyectaba);
#   - new Date() sin argumentos → forgeNow() (reloj que las pruebas pueden fijar);
#   - fuera el componente MD y GoalStat (son pantalla, no lógica).
import re, sys, io

SRC = r'C:\Proyectos\eris-mobile\assets\toji.html'
OUT = r'C:\Proyectos\eris-mobile\src\services\forge\forgeLegacy.ts'

h = io.open(SRC, encoding='utf8').read()
start = h.find('const STORAGE_KEY')
sc = h.rfind('<script', 0, start)
end = h.find('</script>', start)
app = h[sc:end].split('\n')

def find_line(prefix, frm=0):
    for i in range(frm, len(app)):
        if app[i].startswith(prefix):
            return i
    raise SystemExit('no encontré ' + prefix)

i_diab = find_line('const IS_DIABETIC')
i_md = find_line('function MD(')
i_today = find_line('const todayKey')
i_app = find_line('function App(')
head = app[i_diab:i_md]          # IS_DIABETIC, MISSIONS_TO_CLAIM, MAX_LEVEL
body = app[i_today:i_app]

# fuera GoalStat (componente)
txt = '\n'.join(body)
gs = txt.find('const GoalStat')
if gs >= 0:
    ge = txt.find('\nconst ', gs + 10)
    txt = txt[:gs] + txt[ge + 1:]
txt = '\n'.join(head) + '\n' + txt

# íconos
for name in ['Dumbbell', 'Footprints', 'Moon']:
    txt = re.sub(r'(icon:\s*)' + name + r'\b', r"\1'" + name + "'", txt)
leftover = [n for n in ['Dumbbell', 'Footprints', 'Moon'] if re.search(r"(?<!')\b" + n + r"\b(?!')", txt)] + [n for n in ['React.', 'document.', 'localStorage'] if n in txt]
if leftover:
    raise SystemExit('quedó algo de pantalla: ' + str(leftover))

# window → forgeEnv
env_map = {
    'window.__ERIS_IS_DIABETIC__': 'forgeEnv.isDiabetic',
    'window.__ERIS_PROTEIN_RULE__': 'forgeEnv.proteinRule',
    'window.__ERIS_WATER_RULE__': 'forgeEnv.waterRule',
    'window.__ERIS_WATCH_DAYS__': 'forgeEnv.watchDays',
    'window.__RUTINA_MD__': 'forgeEnv.routineMd',
}
for a, b in env_map.items():
    txt = txt.replace(a, b)
rest = re.findall(r'window\.[A-Za-z_]+', re.sub(r'//[^\n]*', '', txt))
if rest:
    raise SystemExit('quedó window: ' + str(set(rest)))

# reloj
txt = txt.replace('new Date()', 'forgeNow()')
if 'Date.now()' in txt:
    raise SystemExit('Date.now() sin portar')

# Gancho: Forge 2.0 cuenta el XP de entrenamiento serie por serie (forgeCore). Las funciones del HTML que lo usan
# (getTotalXp, y por ella la Arena) lo llaman por nombre, así que se deja reasignable con setTrainXpOf.
if 'const trainXpOf = ' not in txt:
    raise SystemExit('trainXpOf cambió')
txt = txt.replace('const trainXpOf = ', 'let trainXpOf = ', 1)
txt += """
/** Forge 2.0: reemplaza el cálculo del XP de entrenamiento (forgeCore lo hace por serie). */
const setTrainXpOf = fn => { trainXpOf = fn; };
"""

# lo que se exporta: todas las declaraciones de primer nivel
names = re.findall(r'^(?:const|function|let) ([A-Za-z_$][\w$]*)', txt, flags=re.M)

hdr = '''// @ts-nocheck
// ============================================================
// Eris Mobile — Forge: la lógica del RPG, portada TAL CUAL desde assets/toji.html (Forge 2.0, F1, 2026-10-17)
//
// ARCHIVO GENERADO (eris/scripts/gen_forge_legacy.py): no se edita a mano. Es el mismo código del HTML (XP, niveles,
// rangos, misiones, árbol de 79 habilidades, 22 subgrupos con su decaimiento, títulos, Arena, metas del cuerpo), con
// cambios mecánicos: íconos → nombre, window.__ERIS_*__ → forgeEnv, new Date() → forgeNow(). Así la migración compara
// «al peso» contra el HTML y el RPG no cambia ni un punto. Lo nuevo de Forge 2.0 vive en forgeCore.ts.
// ============================================================

/** La rutina de ejemplo del HTML (window.__RUTINA_MD__): siempre existe, y las metas de proteína la miran. */
export const SAMPLE_ROUTINE_MD: string = __SAMPLE__;

/** Lo que TojiScreen inyectaba en el WebView (reglas del servidor y días con ejercicio del reloj). */
export const forgeEnv: { isDiabetic: boolean; proteinRule: any; waterRule: any; watchDays: Record<string, number>; routineMd: string | null } = {
  isDiabetic: false, proteinRule: null, waterRule: null, watchDays: {}, routineMd: SAMPLE_ROUTINE_MD,
};
let _now: (() => Date) | null = null;
/** El reloj de Forge (las pruebas lo fijan con setForgeNow). */
export const forgeNow = () => (_now ? _now() : new Date());
export function setForgeNow(fn: (() => Date) | null) { _now = fn; }

'''
# IS_DIABETIC no se usa en la lógica (solo en pantalla): se saca y se lee de forgeEnv
txt = txt.replace('const IS_DIABETIC = !!forgeEnv.isDiabetic;'+chr(10), '')
names = [n for n in names if n != 'IS_DIABETIC']
if 'IS_DIABETIC' in txt:
    raise SystemExit('IS_DIABETIC se usa en la lógica: revisar')

footer = '\n\nexport {\n  ' + ',\n  '.join(sorted(set(names))) + ',\n};\n'
m = re.search(r'window\.__RUTINA_MD__ = ("(?:[^"\\]|\\.)*");', h)
if not m:
    raise SystemExit('no encontré la rutina de ejemplo')
hdr = hdr.replace('__SAMPLE__', m.group(1))
io.open(OUT, 'w', encoding='utf8', newline='\n').write(hdr + txt + footer)
print('ok', len(txt), 'chars,', len(set(names)), 'exports')
