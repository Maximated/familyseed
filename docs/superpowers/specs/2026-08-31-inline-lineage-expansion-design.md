# Expansión de linaje in situ (crecer el árbol desde cualquier tarjeta)

## Contexto

Hoy el botón de "más ascendientes" (icono de rama de git, esquina inferior
izquierda de una tarjeta, `.card-ancestry-toggle` en `TreeView.tsx`) solo
aparece en tarjetas cuyos propios padres existen en los datos pero no se
muestran en el árbol actual — típicamente el cónyuge que se casó con la
familia. Al pincharlo, **recentra todo el árbol** en esa persona
(`chart.updateMainId` + `chart.updateTree`), sustituyendo lo que había en
pantalla.

Petición del usuario: poder añadir a la vista actual (sin perder a la
persona centrada ni lo que ya se ve) los padres/hijos de cualquier persona
que aún no estén dibujados — para poder editar libremente y exportar
después un árbol que combine varios linajes, y para poder asomarse a otras
partes del árbol sin tener que abandonar la vista centrada. Además:

- El botón debe aparecer en **todas** las tarjetas, no solo donde hay
  ascendencia oculta.
- El primer clic revela un nivel en **ambas direcciones** (padres e
  hijos aún no mostrados).
- Un clic posterior en el mismo botón, con la rama ya abierta, **no**
  vuelve a expandir — colapsa. Profundizar más allá de un nivel se hace
  con un control aparte.
- Ese control aparte es un **mini panel flotante** junto a la tarjeta
  que originó la expansión, con `+`/`-` de ascendientes, `+`/`-` de
  descendientes y una `✕` para colapsar del todo.
- Las tarjetas y líneas añadidas deben verse y comportarse
  **exactamente igual** que las del árbol principal — mismos iconos de
  unión, mismo estilo de línea, mismos botones (editar, ver ficha,
  añadir familiar, y su propio botón de expandir linaje, permitiendo
  encadenar expansiones dentro de una expansión) — nada de estilo
  "vista previa" ni líneas discontinuas. Tienen que exportarse igual
  que cualquier otra parte del árbol.
- Al cambiar de persona centrada, todo lo expandido por este mecanismo
  se colapsa (mismo criterio que ya usan los niveles de
  ascendientes/descendientes de la persona centrada).

Esto es aditivo sobre el plan ya existente de "Navegación por niveles +
clic-en-linaje" (`~/.claude/plans/encapsulated-painting-balloon.md`): ese
plan controla la profundidad de la persona centrada; esto añade personas
sueltas alrededor de cualquier tarjeta, centrada o no. No hay solape de
responsabilidades.

## Hallazgo técnico clave

`family-chart` (la librería) calcula su árbol recorriendo una única
jerarquía desde un único `main_id` — no tiene ningún concepto nativo de
"una persona cualquiera, además, con su propia profundidad". Una
investigación previa (para una idea relacionada, mostrar primos) ya
confirmó que el hook de extensión que ofrece la librería para injertar
nodos (`modifyTreeHierarchy`) solo funciona para una fila extra: los
descendientes de esa fila injertada aterrizan en la fila equivocada,
porque el recorte por profundidad de `family-chart` da por hecho una
única pasada por dirección desde un único origen.

Sin embargo, `family-chart` exporta también `calculateTree(data,
options)` — la misma función de cálculo de posiciones, pero **pura**:
sin DOM, sin zoom, sin mutar nada. Acepta las mismas opciones que ya
configuramos para el árbol principal (`node_separation`,
`level_separation`, `is_horizontal`, `sortChildrenFunction`,
`single_parent_empty_card`, `show_siblings_of_main`, `main_id`,
`ancestry_depth`, `progeny_depth`) y devuelve `{ data: nodos, dim }`
donde cada nodo trae `.data` (la persona), `.x`/`.y` (posición) y
`.depth`. Esto permite calcular la posición de "los padres/hijos de la
persona X, N niveles" de forma totalmente independiente del árbol
principal, con la misma calidad de layout (parejas, hermanos, huecos
para familia monoparental) sin reimplementar nada de eso a mano.

La otra pieza clave: si las tarjetas y líneas que añadimos usan
**exactamente las mismas clases/estructura** que ya produce
`family-chart` para las suyas (`div.card-inner[data-person-id]` con el
wrapper `style="transform: translate(Xpx, Ypx)"`, `path.link`,
`path.link.union-line`, `g.link-text[data-family-id]`, los botones
`.card-edit-toggle` / `.card-ancestry-toggle` / etc. con su
`data-person-id`) y un objeto `__data__` con la misma forma que usa
`family-chart` (`{ source, target }` para un `path.link`), entonces
**todo el código que ya existe** en `wireCardAndUnionClicks` las trata
exactamente igual que a cualquier tarjeta real, sin escribir ese código
dos veces:

- Los botones de editar / ver ficha / añadir familiar / expandir linaje
  funcionan solos (esos handlers ya buscan por `data-person-id` en todo
  `container`, no solo dentro de lo que dibuja `family-chart`).
- Los límites de paneo (`applyPanBounds`) ya escanean
  `.card[data-id]` en todo `container` — las tarjetas añadidas amplían
  el área de paneo automáticamente.
- El ocultado de líneas "huérfanas" y la visibilidad del propio botón
  de expandir linaje (`updateAncestryToggles`, hoy basado en
  `.card-inner[data-person-id]` de todo `container`) ya funcionan sobre
  cualquier tarjeta presente en el DOM, la haya dibujado quien la haya
  dibujado.
- Los iconos de unión (tipo, estado, color por 2º+ matrimonio ya
  implementado hoy) y la exportación a PNG/SVG en negro tratan
  `path.link` por clase/atributo, no por quién lo creó.

La única pega real: `family-chart` vuelve a dibujar sus propios
contenedores (`.cards_view`, `.links_view`) en cada actualización del
árbol (cualquier edición, cualquier navegación), y su propio *data join*
de d3 sobre esos contenedores concretos borraría cualquier tarjeta/línea
"extra" que hubiéramos metido ahí, porque no aparece en sus propios datos
calculados. Solución: las tarjetas/líneas añadidas viven en un
**contenedor propio, hermano** de esos (mismo `container` padre, pero
con su propia clase, p. ej. `.lineage-extra-view`), al que `family-chart`
nunca aplica su `selectAll(...).data(...)` — así sobreviven a cualquier
actualización del árbol principal sin que family-chart las toque. A
cambio, nuestro propio código debe volver a calcular y volver a insertar
ese contenido en cada pase de render (el mismo patrón de "settle" que ya
usa este archivo en varios sitios — no es un mecanismo nuevo).

## Modelo de estado

```ts
type LineageBranch = {
  rootPersonId: string;   // clave — una rama por persona, no acumulable
  ancestryDepth: number;  // arranca en 1
  progenyDepth: number;   // arranca en 1
};
```

Vive como estado de React normal en `TreeView.tsx`
(`const [lineageBranches, setLineageBranches] = useState<LineageBranch[]>([])`),
junto al resto del estado de selección. Se vacía por completo en el mismo
punto donde ya se resetean los niveles de ascendientes/descendientes de
la persona centrada, dentro de `chart.setAfterUpdate`, cuando
`newMainId !== currentMainIdRef.current`.

## Cálculo y posicionado

Nueva función `renderLineageBranches()` (su propio `useCallback`,
paralelo a `wireCardAndUnionClicks`, no integrado dentro de esa función
ya extensa), invocada **antes** de `wireCardAndUnionClicks()` en el mismo
`chart.setAfterUpdate`, para que el resto del cableado de esa función
recoja las tarjetas/líneas añadidas en la misma pasada:

1. Vacía y reconstruye `.lineage-extra-view` desde cero en cada pase
   (más simple y robusto que diferenciar altas/bajas; el volumen de
   datos en juego —ramas abiertas a mano por el usuario— no justifica
   optimizar esto).
2. Para cada `LineageBranch` en el estado:
   a. Llama a `calculateTree(treeDataRef.current como ChartData, { main_id: rootPersonId, ancestry_depth: branch.ancestryDepth, progeny_depth: branch.progenyDepth, node_separation: 265, level_separation: 245, is_horizontal: orientationRef.current === "horizontal", single_parent_empty_card: false, show_siblings_of_main: true, sortChildrenFunction: <la misma función ya usada en chart.setSortChildrenFunction> })`.
   b. Busca en `result.data` el nodo cuyo `data.id === rootPersonId` — es
      la persona cuya tarjeta *ya* existe de verdad en el árbol
      principal. Lee su posición real en pantalla con
      `cardWrapperPixelPos(rootPersonId)` (ya existe en este archivo) y
      calcula el desplazamiento (`offsetX/offsetY`) entre esa posición
      real y la posición local que le dio `calculateTree` — ese mismo
      desplazamiento se aplica a **todos** los demás nodos del
      resultado, para que encajen exactamente donde irían si
      `family-chart` los hubiera dibujado él mismo.
   c. Omite el propio nodo raíz (ya existe, no se duplica) y cualquier
      nodo cuyo id ya esté presente como tarjeta real — ya sea en el
      árbol principal o en otra `LineageBranch` ya insertada en este
      mismo pase — (evita duplicar a alguien que resulta ser, además,
      visible por otra vía; coherente con cómo esta app ya trata los
      bucles genealógicos: se prioriza la tarjeta ya existente).
   d. Detección de colisión: si algún nodo trasladado se solaparía con
      una tarjeta ya ocupada (del árbol principal o de otra rama ya
      insertada en este mismo pase), desplaza el **grupo entero** de
      esta rama (no un nodo suelto) en incrementos horizontales fijos
      hasta que no haya solape — mantiene intacta la forma interna de la
      rama.
   e. Sintetiza en `.lineage-extra-view`: por cada nodo restante, un
      wrapper `div` con `style="transform: translate(Xpx, Ypx)"` que
      contiene `.card-inner[data-person-id]` construido con la misma
      `cardTemplate()` ya usada por el árbol principal; por cada arista
      padre-hijo o cónyuge entre dos nodos ya insertados (o entre un
      nodo insertado y una tarjeta real ya existente), un `path.link`
      (con `.union-line` si es de pareja) con `__data__` en la misma
      forma que usa `family-chart` (`{ source, target }` con
      `{data:{id}, x, y, sx}` cuando aplica).
3. Después de esto, `wireCardAndUnionClicks()` corre normalmente y
   recoge todo lo anterior sin cambios propios.

## Interacción

- El icono existente (rama de git) pasa a mostrarse en **todas** las
  tarjetas — se elimina la condición `hasUnrenderedParent` que hoy
  regula su visibilidad en `updateAncestryToggles`.
- Tooltip/`aria-label` nuevos (nueva clave i18n `card.expandLineage`,
  sustituye a `card.moreAncestry` que queda sin uso y se retira de los
  tres idiomas): algo como "Mostrar sus padres/hijos que aún no se ven".
- El icono adopta un estado visual "activo" (relleno en vez de
  contorno) en cualquier tarjeta cuya persona tenga una `LineageBranch`
  abierta ahora mismo.
- **Primer clic** en una tarjeta sin rama abierta: añade una entrada
  `{ rootPersonId, ancestryDepth: 1, progenyDepth: 1 }` al estado.
- **Clic en una tarjeta cuya rama ya existe**: la elimina del estado
  (colapsa del todo) — mismo gesto, comportamiento contextual según si
  ya hay rama o no.
- Mini panel flotante (nuevo componente, p. ej. `LineageBranchControls`),
  anclado a la posición en pantalla de la tarjeta raíz de cada rama
  abierta, con dos pares `+`/`-` (ascendientes/descendientes de esa
  rama concreta, mismo patrón visual que los botones ya existentes de
  ascendientes/descendientes de la persona centrada) y una `✕` que hace
  lo mismo que un segundo clic en el icono de la tarjeta.
- Dentro de una rama ya abierta, cada tarjeta añadida tiene sus propios
  botones reales — incluido su propio icono de expandir linaje, que
  puede abrir una `LineageBranch` adicional (con su propia
  `rootPersonId`) anidada.

## Qué se deja fuera de esta primera versión (seguimiento, no bloqueante)

- Alineación en vivo si una corrección posterior de `wireCardAndUnionClicks`
  (p. ej. el ajuste de hijo único) desplaza la tarjeta de origen después
  de que `renderLineageBranches` ya haya calculado el desplazamiento —
  en ese caso la rama añadida no se recoloca sola hasta el siguiente
  pase completo. Caso raro; se revisita solo si se observa en la
  práctica.
- Empaquetado óptimo para evitar solapes entre muchas ramas abiertas a
  la vez — el desplazamiento por incrementos fijos es suficiente para
  el uso esperado (unas pocas ramas), no una colocación perfecta.
- Retomar la idea de "primos" del otro plan usando esta misma técnica
  — queda anotado como posible trabajo futuro, fuera de alcance aquí.

## Pruebas

Árbol Prisma desechable con al menos 3 generaciones, una persona con
ascendencia real alcanzable por dos vías (para probar la deduplicación
de nodos ya visibles), y una unión con hijos para comprobar que el
icono/color de matrimonio y el hover de unión funcionan igual en una
tarjeta añadida. Playwright: abrir una rama (aparecen padres e hijos
nuevos pegados a la tarjeta real, con líneas normales), profundizar con
el panel flotante, colapsar con `✕` y con un segundo clic en el icono,
abrir una rama anidada desde dentro de otra rama, exportar a PNG y
comprobar que las tarjetas añadidas aparecen en la imagen. `tsc` limpio
en frontend. Limpieza del árbol/usuario de prueba al terminar.
