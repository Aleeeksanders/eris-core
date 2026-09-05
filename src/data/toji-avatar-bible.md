# Proyecto Toji — Sistema de Avatares (PixAI)
El avatar es **un solo personaje (tú) que evoluciona**. Dos ejes INDEPENDIENTES:
- **RANGO (nivel)** → define el **cuerpo y el aura**. (de flaco a lean muscular)
- **CLASE (opcional)** → define **vestimenta, gear, pose y color**. NO cambia el físico.
> Importante: la clase NO te hace más "mamado". Podés ser velocista o escalador y seguir
> lean — el músculo lo da el rango, no la disciplina. Sin clase = avatar base en ropa neutra.
Fórmula: **[ Personaje base ] + [ Tier de rango ] + [ Clase o Base ] + [ House style ]**
Estética: Solo Leveling / manhwa, físico Toji Fushiguro (lean muscular).
Tema app: fondo #0c0b0e, rojo #ff3b4e, dorado #f5c542, azul #56b3ff, naranja #ff7a4e.
---
## 0. CONFIGURACIÓN FIJA
- **Modelo:** familia Illustrious (look glossy/semi-realista).
- **Style LoRA:** un *manhwa / Solo Leveling style LoRA* compatible con Illustrious, peso **0.7**.
- **Consistencia (CLAVE):** entrená un **character LoRA** del avatar base (15–30 imágenes) y úsalo
  en TODO (peso ~0.8) → misma cara en los 80 niveles y en todas las clases. Mientras tanto: **seed fijo**.
- **Tamaño:** full body 768x1152 · retrato 1024x1024.
### Personaje base (no cambiar)
```
1boy, solo, short black hair, sharp green eyes, handsome, calm cold expression
```
### Negativo estándar
```
worst quality, low quality, bad anatomy, bad hands, bad feet, extra fingers,
extra limbs, deformed, blurry, watermark, signature, text, 1girl, female,
bulky, bodybuilder, fat
```
### Versión femenina
`1boy`→`1girl`; saca `1girl, female` del negativo (pon `1boy, male`); físico `athletic toned body`.
---
## 1. TIERS DE RANGO
| Tier | Niveles | Snippet |
|---|---|---|
| T1 | El Despertar · Aspirante (1–9) | `slim build, lean, beginner physique, faint red glow` |
| T2 | Guerrero en Ascenso · Atleta (10–29) | `toned athletic body, lean muscle, confident posture, subtle aura` |
| T3 | Cuerpo Forjado · Mov. Fluido (30–49) | `athletic build, v-shaped back, defined abs, powerful stance, glowing aura` |
| T4 | Sombra Ágil · Depredador (50–69) | `peak athletic lean muscular build, intense glowing aura, shadow particles` |
| T5 | Sin Cadenas · TOJI FUSHIGURO (70–80) | `perfect lean muscular physique, scar on lip, overwhelming dark aura, glowing eyes, shadow particles` |
---
## 2. AVATAR BASE (sin clase)
```
1boy, solo, short black hair, sharp green eyes, handsome, [TIER SNIPPET],
plain black tank top, black athletic shorts, barefoot, full body, neutral confident stance,
dark training hall, red rim light, glowing red system window, particles,
solo leveling style, dramatic lighting, depth of field,
masterpiece, best quality, high detail, very aesthetic
```
---
## 3. CLASES
### Artes marciales
| Clase | Color | Outfit / gear | Pose |
|---|---|---|---|
| Calistenia | rojo `#ff3b4e` | shirtless, athletic shorts, hand wraps, anillas | front lever on rings / muscle-up |
| Taekwondo | azul `#56b3ff` | white dobok, blue belt, barefoot | dynamic high kick |
| Karate | dorado `#f5c542` | white karate gi, black belt | focused punch, strong stance |
| Boxeo | naranja `#ff7a4e` | boxing gloves, hand wraps, shirtless | boxing guard / cross punch |
### Acondicionamiento
| Clase | Color | Outfit / gear | Pose |
|---|---|---|---|
| Atletismo (Velocidad) | lima `#a6f53b` | running tank top, athletic shorts, running spikes | explosive sprint start, motion blur |
| Natación | cian `#3bd0ff` | swim jammers, wet skin, broad shoulders | poolside ready stance / swimming, water splash |
| Gimnasia | violeta `#b06bff` | shirtless, chalked hands, athletic | iron cross on rings / planche on parallel bars |
| Parkour / Freerunning | turquesa `#2ee6c9` | hoodie, joggers, sneakers | mid wall-run / vault, dynamic leap, motion blur |
| Escalada | ámbar `#e0823b` | tank top, leggings, chalk bag, wiry lean | climbing on wall, reaching for hold |
| Grappling / MMA | carmesí `#ff2e63` | rashguard, fight shorts, barefoot | takedown stance / guard, intense |
---
## 4. FÓRMULA DE ENSAMBLE
```
[PERSONAJE BASE], [TIER SNIPPET], [CLASE: outfit + gear],
full body, [CLASE: pose],
dark training hall, [COLOR] rim light, glowing [COLOR] system window, particles,
solo leveling style, dramatic lighting, depth of field,
masterpiece, best quality, high detail, very aesthetic
```
---
## 5. RETRATO / BUST
```
1boy, solo, upper body, short black hair, sharp green eyes, handsome, calm cold expression,
[físico según tier], [outfit de clase o tank top neutro], dark background,
[COLOR] rim light, dark aura, shadow particles, glowing [COLOR] system window,
solo leveling style, masterpiece, best quality, high detail, very aesthetic
```
---
## 6. CHIBI (iconos)
```
chibi, 1boy, solo, short black hair, green eyes, [outfit de clase], [gear], [COLOR] aura,
big head, small body, full body, cute, simple background, white background,
masterpiece, best quality, high detail
```
---
## 7. FLUJO DE GENERACIÓN
1. Genera el **avatar base** (T2, sin clase) hasta que te guste. Anota el seed.
2. Junta 15–30 variantes → entrena el **character LoRA**.
3. Con el LoRA fijo: 1 base por tier (5) + cada clase × tiers necesarios.
4. La clase solo cambia ropa/pose/color. El tier solo cambia cuerpo/aura.

### Ajustes rápidos
- Cuerpo muy inflado → `(lean muscular:1.2)` + negativo `bulky, bodybuilder`
- Aura débil → `(overwhelming dark aura:1.3)`
- Pose rígida → `(dynamic pose:1.2)`
- Cara cambia entre versiones → el character LoRA lo resuelve
