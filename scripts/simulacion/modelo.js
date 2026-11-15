// ============================================================
// Simulador del negocio de Eris y AXS — el modelo (2026-11-11)
//
// Puro, sin pantalla: lo usan la página (scripts/simulacion/pagina.html) y las pruebas (tests/simulacion.test.ts).
// Mes a mes: instalaciones → personas que pagan → renovaciones → plata que entra (sin IVA ni comisión) → equipo propio,
// luz y costos de la empresa → caja. Lo que nadie sabe va como rango y se corre muchas veces (monteCarlo).
// Cada valor base dice de dónde sale: medido (tus datos), referencia (estudio o tarifa), tuyo (decisión) o estimado.
// Fuentes y supuestos: bóveda AXS, 30-39/Finanzas/Simulación del Negocio.
// ============================================================
(function (root) {
  'use strict';

  /** Valores base. Plata en pesos chilenos; los precios, con IVA (como los ve la persona). */
  var BASE = {
    meses: 36,
    mesCobro: 4,                 // tuyo: hasta ahí la beta es gratis
    cajaInicial: 0,

    // Precios (2026-11-14, ver compararPrecios): Eris es gratis con el chat, la comida, el agua, el sueño, el plan del día, las
    // métricas y la salud. Forge, Finanzas e Inventario se pagan aparte, $1.990 al mes cada uno (después GlucoTrack y Mente), o
    // todo junto en Eris completo: $4.990 al mes o $34.990 al año (ahorra 42 %).
    precioModulo: 1990, modulosPorPersona: 1.2, precioCompleto: 4990, precioAnual: 34990, // estimado: 1,2 módulos por persona
    // Cuánto cambia la conversión con el precio: conversión × (precioReferencia / precio mensual) ^ elasticidad.
    precioReferencia: 4990,      // estimado: la conversión de referencia es de apps cerca de US$ 5 al mes (Latinoamérica, RevenueCat)
    elasticidad: 0.6,            // estimado: 1 = la conversión cae en proporción al precio; 0 = el precio no la mueve
    iva: 0.19,                   // referencia: quien vive en Chile cobra y entera el IVA (Google Play)
    comision: 0.15,              // referencia: Google Play, suscripciones; sobre el precio sin IVA

    // Gente
    instalacionesMes0: 300,      // estimado: no hay dato, lo dirá el lanzamiento
    crecimientoMensual: 0.06,    // estimado
    maxInstalacionesMes: 30000,
    marketingMensual: 0,         // tuyo
    costoPorInstalacionUSD: 0.8, // referencia: Latinoamérica US$ 0,34–2,00 (blogs de proveedores)
    dolar: 975,                  // referencia: dólar observado, noviembre de 2026
    conversion: 0.02,            // referencia: RevenueCat 2026, instalación → pago en 35 días: 2,1 % con versión gratis; 1,5 % en Latinoamérica
                                 // y 2,9 % en salud y deporte. Se paga por una herramienta concreta (Forge, Finanzas), no por comodidad.
                                 // Con todo gratis y solo comodidades de pago (Eris+, 2026-11-12) se usaba 1,5 %
    mixModulo: 0.30,             // estimado: eligen un módulo suelto en vez del completo
    mixAnual: 0.35,              // estimado: de los que toman el completo, la mitad elige el anual (ahorra 42 %); en salud y deporte el 68 % de
                                 // todos elige anual (RevenueCat 2026). Ver mixAnualPorAhorro
    renovPrimera: 0.57,          // referencia: primera renovación mensual, salud y deporte (46–68 %)
    renovSiguientes: 0.85,       // estimado: las siguientes suben; el informe no da la cifra en texto
    renovAnual: 0.25,            // referencia: primera renovación anual (16–37 %)
    renovAnualSiguientes: 0.60,  // estimado
    usoPrueba: 0.25,             // estimado: parte de las instalaciones del mes que usa el chat ese primer mes

    // El chat para quien no paga (2026-11-11)
    planChat: 'tope',            // tuyo (2026-11-12): el chat es gratis, con un tope alto solo contra el abuso. 'libre' = sin tope;
                                 // 'tope' = hasta `topeModeloDia` respuestas del modelo al día; 'codigo' = solo lo que responde el código
    topeModeloDia: 30,           // tuyo: una persona normal nunca lo toca (el promedio medido es ~2 al día)
    activosMes1: 0.05,           // referencia: siguen usando la app al mes (día 30), salud y deporte: 3,4 % en Android (Braze) a 8,5 % (OneSignal)
    quedanCadaMes: 0.80,         // estimado: de los que siguen al mes, cuántos siguen cada mes siguiente
    usoGratis: 0.5,              // estimado: quien no paga usa el modelo la mitad que lo medido (tú, que lo desarrollas)

    // Uso del chat (medido en tus conversaciones, sep–nov 2026)
    mensajesDia: 3.0,            // medido: 3,0 por día los últimos 30 días (3,6 en 66 días)
    fraccionModelo: 0.69,        // medido: 43 de 62 respuestas con traza pasaron por el modelo
    segundosModelo: 15,          // estimado: en el notebook son 48 s; en el PC de 12 GB se mide al mudar Eris
    horaPunta: 0.13,             // medido: la hora más cargada concentra el 13 % del día
    usoMaximo: 0.5,              // estimado: no pasar de la mitad del PC en la hora punta, para no hacer fila

    // Equipo propio (tuyo)
    costoServidor: 850000,       // referencia: plan de compra, opción A (RTX 3060 de 12 GB)
    upsPorServidor: 100000,      // estimado
    vidaServidorMeses: 36,       // estimado
    respaldo: true,              // un PC de repuesto cuando hay gente pagando
    respaldoDesde: 50,
    wattsReposo: 55,             // referencia: plan de compra (36–43 kWh al mes encendido)
    wattsCarga: 220,             // estimado
    precioKwh: 236,              // referencia: promedio de Santiago
    internetMensual: 30000,      // estimado: una línea para el servidor desde que se cobra

    // Empresa
    contadorMensual: 90000,      // referencia: $70.000–$150.000 al mes para una pyme chica
    otrosFijos: 30000,           // estimado: dominio, túnel o VPS, herramientas
    puestaEnMarcha: 600000,      // estimado: marca, textos legales, cuenta de Google Play. Hay que cotizar
    sueldoLiquido: 1000000,      // tuyo: una cifra redonda para partir; pon la que quieras
    personas: 1,
    costoSobreLiquido: 1.31,     // estimado: lo que le cuesta a la empresa un sueldo líquido. Afinar con el contador
    mesSueldo: -1,               // −1 = no se pagan sueldos (hoy no hay)
    impuestos: [0.125, 0.15, 0.25], // referencia: Pro Pyme 12,5 % (2027), 15 % (2028); después 25 % (podría quedar en 23 %)
  };

  /** Rangos de lo incierto: [bajo, base, alto] con los valores base. Si mueves la base, el rango se mueve en proporción. */
  var RANGOS = {
    instalacionesMes0: [100, 300, 1000],
    crecimientoMensual: [0.02, 0.06, 0.12],
    conversion: [0.01, 0.02, 0.05],
    renovPrimera: [0.46, 0.57, 0.68],
    renovSiguientes: [0.75, 0.85, 0.92],
    renovAnual: [0.16, 0.25, 0.37],
    mixAnual: [0.25, 0.50, 0.68],   // el alto es la referencia de salud y deporte (se escala con la base: 0,35 → 0,18–0,48)
    elasticidad: [0.2, 0.6, 1.2],
    mixModulo: [0.15, 0.30, 0.45],
    mensajesDia: [1.5, 3.0, 6.0],
    fraccionModelo: [0.5, 0.69, 0.85],
    segundosModelo: [8, 15, 30],
    costoPorInstalacionUSD: [0.34, 0.8, 2.0],
    costoServidor: [830000, 850000, 1360000],
    activosMes1: [0.03, 0.05, 0.09],
    quedanCadaMes: [0.65, 0.80, 0.90],
    usoGratis: [0.25, 0.5, 1.0],
  };
  var TOPE = { conversion: 0.5, renovPrimera: 0.98, renovSiguientes: 0.98, renovAnual: 0.95, mixAnual: 0.9, mixModulo: 0.9, fraccionModelo: 1, crecimientoMensual: 0.5, activosMes1: 0.5, quedanCadaMes: 0.98, usoGratis: 3, elasticidad: 3 };

  var NOMBRES = {
    instalacionesMes0: 'Instalaciones del primer mes', crecimientoMensual: 'Crecimiento de las instalaciones', conversion: 'Cuántos de los que instalan pagan',
    renovPrimera: 'Renuevan el segundo mes', renovSiguientes: 'Renuevan los meses siguientes', renovAnual: 'Renuevan el plan anual',
    mixAnual: 'Eligen el plan anual', mixModulo: 'Eligen un módulo suelto', mensajesDia: 'Mensajes al día por persona',
    fraccionModelo: 'Respuestas que pasan por el modelo', segundosModelo: 'Segundos del PC por respuesta', costoPorInstalacionUSD: 'Costo de cada instalación con publicidad',
    costoServidor: 'Precio de cada PC', activosMes1: 'Siguen usando la app al mes', quedanCadaMes: 'De esos, siguen cada mes',
    usoGratis: 'Cuánto usa el modelo quien no paga', elasticidad: 'Cuánto baja la conversión si sube el precio',
  };

  var PLANES_CHAT = {
    libre: 'Chat completo gratis',
    tope: 'Todo el chat gratis, con tope contra el abuso',
    codigo: 'Gratis solo lo que responde el código',
  };

  function unir(p) { var o = {}; for (var k in BASE) o[k] = BASE[k]; for (var j in (p || {})) if (p[j] !== undefined) o[j] = p[j]; return o; }

  /** El rango de un valor incierto con la base actual: [bajo, alto]. */
  function rangoDe(p, clave) {
    var r = RANGOS[clave];
    if (!r) return null;
    var v = p[clave], tope = TOPE[clave] != null ? TOPE[clave] : Infinity;
    if (!(r[1] > 0)) return [r[0], r[2]];
    return [Math.min(tope, v * (r[0] / r[1])), Math.min(tope, v * (r[2] / r[1]))];
  }

  /** La conversión al precio mensual elegido: la de referencia, ajustada por la elasticidad. */
  function conversionEfectiva(p0) {
    var p = unir(p0);
    if (!(p.precioCompleto > 0) || !(p.precioReferencia > 0) || !p.elasticidad) return p.conversion;
    return Math.min(TOPE.conversion, p.conversion * Math.pow(p.precioReferencia / p.precioCompleto, p.elasticidad));
  }

  /** Cuánto ahorra el anual frente a pagar 12 meses. */
  function ahorroAnual(p0) { var p = unir(p0); return p.precioCompleto > 0 ? 1 - p.precioAnual / (12 * p.precioCompleto) : 0; }

  /**
   * Estimado: qué parte elige el anual según cuánto ahorra. 16 % de ahorro → 25 %; 42 % → 50 %; nunca más que el 68 % de
   * salud y deporte (RevenueCat 2026), ni menos de 10 %.
   */
  function mixAnualPorAhorro(ahorro) { return Math.max(0.10, Math.min(0.68, 0.25 + (ahorro - 0.16) * (0.25 / 0.26))); }

  /** Lo que llega de un precio con IVA: se resta el IVA y, sobre lo que queda, la comisión de la tienda. */
  function netoDe(p, precio) { return (precio / (1 + p.iva)) * (1 - p.comision); }

  /** De cada suscripción: cuánto es IVA, cuánto comisión y cuánto queda. */
  function porSuscripcion(p0, precio) {
    var p = unir(p0), sinIva = precio / (1 + p.iva);
    return { precio: precio, iva: precio - sinIva, comision: sinIva * p.comision, queda: sinIva * (1 - p.comision) };
  }

  /** Cuántas personas aguanta un PC: lo que alcanza a responder en la hora punta, sin pasar del uso máximo. */
  function capacidadPorServidor(p0) {
    var p = unir(p0);
    var segundosPunta = p.mensajesDia * p.fraccionModelo * p.segundosModelo * p.horaPunta; // por persona, en la hora más cargada
    if (!(segundosPunta > 0)) return Infinity;
    return Math.max(1, Math.floor((3600 * p.usoMaximo) / segundosPunta));
  }

  /**
   * Cuánto usa el modelo una persona que no paga, comparada con una que paga (1 = igual), según el plan del chat.
   * Con tope: se supone que el uso varía mucho entre personas (exponencial), así que el tope recorta a los que más usan:
   * lo que queda es 1 − e^(−tope / promedio).
   */
  function factorGratis(p0) {
    var p = unir(p0);
    if (p.planChat === 'codigo') return 0;
    if (p.planChat === 'tope') {
      var promedio = p.mensajesDia * p.fraccionModelo * p.usoGratis;
      if (!(promedio > 0)) return 0;
      return p.usoGratis * (1 - Math.exp(-Math.max(0, p.topeModeloDia) / promedio));
    }
    return p.usoGratis;
  }

  /** Lo que cuesta al mes un PC encendido y trabajando a su capacidad (equipo repartido en su vida útil + luz). */
  function costoMesPorPc(p0) {
    var p = unir(p0), cap = capacidadPorServidor(p);
    var horas = isFinite(cap) ? (cap * p.mensajesDia * p.fraccionModelo * p.segundosModelo * 30.4) / 3600 : 0;
    var luz = ((p.wattsReposo * 730 + Math.max(0, p.wattsCarga - p.wattsReposo) * horas) / 1000) * p.precioKwh;
    return (p.costoServidor + p.upsPorServidor) / p.vidaServidorMeses + luz;
  }

  /** Lo que le cuesta al PC, al mes, una persona que paga y una activa que no paga. */
  function costoPorPersona(p0) {
    var p = unir(p0), cap = capacidadPorServidor(p);
    var porPaga = isFinite(cap) ? costoMesPorPc(p) / cap : 0;
    return { paga: porPaga, gratis: porPaga * factorGratis(p) };
  }

  /** Lo que le cuestan a la empresa los sueldos, al mes. */
  function costoSueldos(p0) { var p = unir(p0); return p.sueldoLiquido * p.personas * p.costoSobreLiquido; }

  /** Cuántos meses paga, en promedio, quien entra a un plan mensual, y cuántos años quien entra al anual. */
  function duracion(p0) {
    var p = unir(p0);
    return {
      mesesMensual: 1 + p.renovPrimera / Math.max(0.01, 1 - p.renovSiguientes),
      pagosAnual: 1 + p.renovAnual / Math.max(0.01, 1 - p.renovAnualSiguientes),
    };
  }

  /** Lo que deja en total una persona que paga, contra lo que costaría traerla con publicidad. */
  function valorPorPersona(p0) {
    var p = unir(p0), d = duracion(p), mixCompleto = Math.max(0, 1 - p.mixModulo - p.mixAnual);
    var deja = p.mixModulo * netoDe(p, p.precioModulo * p.modulosPorPersona) * d.mesesMensual
      + mixCompleto * netoDe(p, p.precioCompleto) * d.mesesMensual
      + p.mixAnual * netoDe(p, p.precioAnual) * d.pagosAnual;
    var conv = conversionEfectiva(p);
    var traerla = conv > 0 ? (p.costoPorInstalacionUSD * p.dolar) / conv : Infinity;
    return { deja: deja, traerla: traerla };
  }

  /** Cuántos suscriptores hacen falta para cubrir un monto al mes (aprox.: con la mezcla de planes ya estable). */
  function suscriptoresParaCubrir(p0, monto) {
    var p = unir(p0), d = duracion(p), mixCompleto = Math.max(0, 1 - p.mixModulo - p.mixAnual);
    var wM = p.mixModulo * d.mesesMensual, wC = mixCompleto * d.mesesMensual, wA = p.mixAnual * d.pagosAnual * 12;
    var total = wM + wC + wA;
    if (!(total > 0)) return Infinity;
    var netoMes = (wM * netoDe(p, p.precioModulo * p.modulosPorPersona) + wC * netoDe(p, p.precioCompleto) + wA * netoDe(p, p.precioAnual) / 12) / total;
    return netoMes > 0 ? Math.ceil(monto / netoMes) : Infinity;
  }

  /** La simulación, mes a mes. */
  function simular(p0) {
    var p = unir(p0);
    var suma = p.mixModulo + p.mixAnual;
    if (suma > 0.95) { p.mixModulo *= 0.95 / suma; p.mixAnual *= 0.95 / suma; }
    var n = Math.max(1, Math.round(p.meses));
    var cap = capacidadPorServidor(p);
    var conv = conversionEfectiva(p);
    var cpi = p.costoPorInstalacionUSD * p.dolar;
    var mesEmpresa = Math.max(0, p.mesCobro - 1);
    var sueldosMes = costoSueldos(p);
    var primer = { m: 0, c: 0 }, antiguos = { m: 0, c: 0 }, anuales = [], compras = [];
    var fGratis = factorGratis(p), retenidos = 0, instAnterior = 0; // gente que no paga y sigue usando la app (desde su 2.º mes)
    var caja = p.cajaInicial, baseBeta = 0, resultadoAnio = 0, perdida = 0, minCaja = p.cajaInicial;
    var filas = [];
    for (var t = 0; t < n; t++) {
      var cobra = t >= p.mesCobro;
      var organicas = Math.min(p.maxInstalacionesMes, p.instalacionesMes0 * Math.pow(1 + p.crecimientoMensual, t));
      var pagadas = cobra && p.marketingMensual > 0 && cpi > 0 ? p.marketingMensual / cpi : 0;
      var instalaciones = organicas + pagadas;
      // Los mensuales que ya estaban: renuevan o se van
      antiguos = { m: antiguos.m * p.renovSiguientes + primer.m * p.renovPrimera, c: antiguos.c * p.renovSiguientes + primer.c * p.renovPrimera };
      var nuevos = 0;
      if (cobra) nuevos = instalaciones * conv + (t === p.mesCobro ? baseBeta * conv : 0);
      else baseBeta += instalaciones;
      var nMod = nuevos * p.mixModulo, nAnu = nuevos * p.mixAnual, nCom = nuevos - nMod - nAnu;
      primer = { m: nMod, c: nCom };
      // Los anuales pagan todo de una vez, y de nuevo a los 12 meses si renuevan
      var pagosAnuales = nAnu;
      for (var i = 0; i < anuales.length; i++) {
        var edad = t - anuales[i].inicio;
        if (edad > 0 && edad % 12 === 0) { anuales[i].n *= edad === 12 ? p.renovAnual : p.renovAnualSiguientes; pagosAnuales += anuales[i].n; }
      }
      if (nAnu > 0) anuales.push({ inicio: t, n: nAnu });
      var subsAnual = 0;
      for (var k = 0; k < anuales.length; k++) subsAnual += anuales[k].n;
      var subsMod = primer.m + antiguos.m, subsCom = primer.c + antiguos.c;
      var suscriptores = subsMod + subsCom + subsAnual;
      var bruto = subsMod * p.precioModulo * p.modulosPorPersona + subsCom * p.precioCompleto + pagosAnuales * p.precioAnual;
      var iva = bruto - bruto / (1 + p.iva);
      var comision = (bruto - iva) * p.comision;
      var ingreso = bruto - iva - comision;
      // Quien no paga: el primer mes prueba (usoPrueba); después siguen activosMes1 y cada mes se va una parte.
      // Con el plan 'codigo', después de probar ya no usa el modelo (el código no ocupa el PC).
      retenidos = retenidos * p.quedanCadaMes + instAnterior * p.activosMes1;
      instAnterior = instalaciones;
      var gratisActivos = instalaciones * p.usoPrueba + retenidos;
      // Equipo: los PC que hacen falta para la hora punta, más el de repuesto. Carga en «personas que pagan equivalentes».
      var carga = suscriptores + instalaciones * p.usoPrueba * p.usoGratis + retenidos * fGratis;
      var necesarios = Math.max(1, Math.ceil(carga / cap)) + (p.respaldo && suscriptores >= p.respaldoDesde ? 1 : 0);
      var capex = 0;
      while (compras.length < necesarios) { compras.push(t); capex += p.costoServidor + p.upsPorServidor; }
      for (var c = 0; c < compras.length; c++) if (t - compras[c] >= p.vidaServidorMeses) { compras[c] = t; capex += p.costoServidor; }
      var servidores = compras.length;
      var horasModelo = (carga * p.mensajesDia * p.fraccionModelo * p.segundosModelo * 30.4) / 3600;
      var kwh = (servidores * p.wattsReposo * 730 + Math.max(0, p.wattsCarga - p.wattsReposo) * horasModelo) / 1000;
      var luz = kwh * p.precioKwh;
      var internet = cobra ? p.internetMensual : 0;
      var contador = t >= mesEmpresa ? p.contadorMensual : 0;
      var marketing = cobra ? p.marketingMensual : 0;
      var unaVez = t === mesEmpresa ? p.puestaEnMarcha : 0;
      var sueldos = p.mesSueldo >= 0 && t >= p.mesSueldo ? sueldosMes : 0;
      var operacion = luz + internet + contador + p.otrosFijos + marketing;
      var quedaParaSueldos = ingreso - operacion;          // antes de sueldos, compras de equipo y puesta en marcha
      var resultado = quedaParaSueldos - sueldos - capex - unaVez;
      resultadoAnio += resultado;
      var impuesto = 0;
      if ((t + 1) % 12 === 0) {                           // cierre del año: se paga sobre la utilidad, descontando pérdidas anteriores
        var baseImp = resultadoAnio - perdida;
        var tasa = p.impuestos[Math.min(p.impuestos.length - 1, Math.floor(t / 12))];
        if (baseImp > 0) { impuesto = baseImp * tasa; perdida = 0; } else perdida = -baseImp;
        resultadoAnio = 0;
      }
      caja += resultado - impuesto;
      if (caja < minCaja) minCaja = caja;
      filas.push({
        mes: t + 1, cobra: cobra, instalaciones: instalaciones, nuevos: nuevos, subsModulo: subsMod, subsCompleto: subsCom, subsAnual: subsAnual, suscriptores: suscriptores,
        bruto: bruto, iva: iva, comision: comision, ingreso: ingreso, luz: luz, internet: internet, contador: contador, fijos: p.otrosFijos, marketing: marketing,
        sueldos: sueldos, capex: capex, unaVez: unaVez, impuesto: impuesto, operacion: operacion, quedaParaSueldos: quedaParaSueldos, resultado: resultado, caja: caja,
        servidores: servidores, carga: carga, gratisActivos: gratisActivos,
      });
    }
    // Resumen
    var promedio3 = function (hasta, campo) { // promedio de los 3 meses que terminan en `hasta` (los anuales entran de golpe)
      var a = Math.max(0, hasta - 3), b = Math.min(n, hasta), s = 0;
      if (b <= a) return null;
      for (var q = a; q < b; q++) s += filas[q][campo];
      return s / (b - a);
    };
    var sePagaSola = null;
    for (var m = p.mesCobro; m < n; m++) {
      var ok = true;
      for (var z = m; z < Math.min(n, m + 3); z++) if (filas[z].quedaParaSueldos - filas[z].sueldos < 0) { ok = false; break; }
      if (ok && m + 3 <= n) { sePagaSola = m + 1; break; }
    }
    var hitos = {};
    [12, 24, 36, 48, 60].forEach(function (h) {
      if (h <= n) hitos[h] = { suscriptores: filas[h - 1].suscriptores, ingreso: promedio3(h, 'ingreso'), queda: promedio3(h, 'quedaParaSueldos'), caja: filas[h - 1].caja, servidores: filas[h - 1].servidores };
    });
    var ult = filas[n - 1];
    var costoServir = ult.suscriptores > 0 ? (ult.luz + ult.internet + (ult.servidores * p.costoServidor) / p.vidaServidorMeses) / ult.suscriptores : null;
    return {
      filas: filas,
      resumen: {
        capacidad: cap, hayQuePoner: Math.max(0, -minCaja), sePagaSola: sePagaSola, hitos: hitos,
        quedaFinal: promedio3(n, 'quedaParaSueldos'), cajaFinal: ult.caja, suscriptoresFinal: ult.suscriptores, costoServir: costoServir,
      },
    };
  }

  // ─── Lo incierto: muchas corridas ───

  /** Números al azar repetibles (misma semilla, mismos resultados). */
  function azar(semilla) {
    var a = semilla >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function triangular(a, c, b, u) {
    if (!(b > a)) return c;
    var f = (c - a) / (b - a);
    return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }
  function percentil(orden, q) { return orden.length ? orden[Math.min(orden.length - 1, Math.max(0, Math.floor(q * orden.length)))] : null; }

  /** Corre el modelo `corridas` veces, sacando cada valor incierto de su rango. Devuelve las bandas mes a mes y las probabilidades. */
  function monteCarlo(p0, corridas, semilla) {
    var p = unir(p0), n = Math.max(1, Math.round(p.meses)), N = Math.max(10, corridas || 500), rnd = azar(semilla == null ? 7 : semilla);
    var claves = Object.keys(RANGOS), rangos = {};
    claves.forEach(function (k) { rangos[k] = rangoDe(p, k); });
    var series = { suscriptores: [], caja: [], quedaParaSueldos: [] }, t, r;
    for (t = 0; t < n; t++) { series.suscriptores.push([]); series.caja.push([]); series.quedaParaSueldos.push([]); }
    var poner = [], pagaSola = [], quedaEn = {}, finales = [];
    var objetivo = costoSueldos(p);
    for (r = 0; r < N; r++) {
      var q = unir(p);
      for (var i = 0; i < claves.length; i++) q[claves[i]] = triangular(rangos[claves[i]][0], p[claves[i]], rangos[claves[i]][1], rnd());
      var s = simular(q);
      for (t = 0; t < n; t++) { series.suscriptores[t].push(s.filas[t].suscriptores); series.caja[t].push(s.filas[t].caja); series.quedaParaSueldos[t].push(s.filas[t].quedaParaSueldos); }
      poner.push(s.resumen.hayQuePoner);
      pagaSola.push(s.resumen.sePagaSola == null ? Infinity : s.resumen.sePagaSola);
      finales.push(s.resumen.quedaFinal);
      for (var h in s.resumen.hitos) (quedaEn[h] = quedaEn[h] || []).push(s.resumen.hitos[h].queda);
    }
    var num = function (a, b) { return a - b; };
    var bandas = {};
    Object.keys(series).forEach(function (k) {
      bandas[k] = { p10: [], p50: [], p90: [] };
      for (var m = 0; m < n; m++) { var o = series[k][m].sort(num); bandas[k].p10.push(percentil(o, 0.1)); bandas[k].p50.push(percentil(o, 0.5)); bandas[k].p90.push(percentil(o, 0.9)); }
    });
    poner.sort(num); pagaSola.sort(num); finales.sort(num);
    var hitos = {};
    Object.keys(quedaEn).forEach(function (h) {
      var o = quedaEn[h].slice().sort(num);
      hitos[h] = { p10: percentil(o, 0.1), p50: percentil(o, 0.5), p90: percentil(o, 0.9), alcanzaSueldos: objetivo > 0 ? o.filter(function (x) { return x >= objetivo; }).length / o.length : null };
    });
    var antesDe = function (mes) { return pagaSola.filter(function (x) { return x <= mes; }).length / N; };
    return {
      corridas: N, bandas: bandas,
      hayQuePoner: { p10: percentil(poner, 0.1), p50: percentil(poner, 0.5), p90: percentil(poner, 0.9) },
      sePagaSola: { p50: percentil(pagaSola, 0.5), antesDe12: antesDe(12), antesDe24: antesDe(24), antesDeFin: antesDe(n) },
      quedaFinal: { p10: percentil(finales, 0.1), p50: percentil(finales, 0.5), p90: percentil(finales, 0.9) },
      hitos: hitos, objetivoSueldos: objetivo,
    };
  }

  /** Qué supuesto mueve más el resultado: cada uno a su valor bajo y a su valor alto, con el resto en la base. */
  function sensibilidad(p0) {
    var p = unir(p0), base = simular(p).resumen.quedaFinal, out = [];
    Object.keys(RANGOS).forEach(function (k) {
      var r = rangoDe(p, k), a = unir(p), b = unir(p);
      a[k] = r[0]; b[k] = r[1];
      var ra = simular(a).resumen.quedaFinal, rb = simular(b).resumen.quedaFinal;
      out.push({ clave: k, nombre: NOMBRES[k] || k, bajo: r[0], alto: r[1], conBajo: ra, conAlto: rb, efecto: Math.abs(rb - ra) });
    });
    out.sort(function (x, y) { return y.efecto - x.efecto; });
    return { base: base, filas: out };
  }

  /**
   * Las tres formas de ofrecer el chat, con todo lo demás igual. Cuánto cuesta el chat gratis (equipo y luz de más frente a
   * dar solo el código) y cuántas personas que pagan de más harían falta para cubrirlo. No supone que el chat gratis
   * venda más: eso no se sabe; por eso dice cuánto tendría que subir la conversión para pagarse solo.
   */
  function compararChat(p0) {
    var p = unir(p0), out = {};
    var suma = function (f, c) { var s = 0; for (var i = 0; i < f.length; i++) s += f[i][c]; return s; };
    Object.keys(PLANES_CHAT).forEach(function (plan) {
      var q = unir(p); q.planChat = plan;
      var s = simular(q), f = s.filas, ult = f[f.length - 1];
      out[plan] = {
        nombre: PLANES_CHAT[plan], servidores: ult.servidores, gratisActivos: ult.gratisActivos, suscriptores: ult.suscriptores,
        equipoYLuz: suma(f, 'capex') + suma(f, 'luz'), hayQuePoner: s.resumen.hayQuePoner, quedaFinal: s.resumen.quedaFinal,
        sePagaSola: s.resumen.sePagaSola, cajaFinal: s.resumen.cajaFinal, costoGratisPorPersona: costoPorPersona(q).gratis,
      };
    });
    var meses = Math.max(1, Math.round(p.meses)), netoMes = suscriptoresParaCubrir(p, 1e9) > 0 ? 1e9 / suscriptoresParaCubrir(p, 1e9) : 0;
    Object.keys(out).forEach(function (plan) {
      var o = out[plan];
      o.costoChatMes = Math.max(0, (o.equipoYLuz - out.codigo.equipoYLuz) / meses);
      o.pagadoresQueLoCubren = netoMes > 0 ? o.costoChatMes / netoMes : null;
      // La conversión que haría falta para cubrirlo (los suscriptores crecen casi en proporción a la conversión)
      o.conversionNecesaria = o.suscriptores > 0 && o.pagadoresQueLoCubren != null ? conversionEfectiva(p) * (1 + o.pagadoresQueLoCubren / o.suscriptores) : null;
    });
    return { planes: out, netoMesPorSuscriptor: netoMes, conversion: conversionEfectiva(p) };
  }

  /**
   * Las opciones de precio que se compararon (2026-11-12 y 2026-11-14; precios con IVA). La mezcla anual sale de cuánto ahorra
   * el anual, entre los que no eligen un módulo suelto. `factorConversion`: cuánto paga de los que instalan, frente a la base
   * (Eris+ vende comodidad, no herramientas: 1,5 % contra 2 %).
   */
  var OPCIONES_PRECIO = [
    { id: 'antes', nombre: '$3.990 al mes · $39.990 al año · módulos a $1.490', precioCompleto: 3990, precioAnual: 39990, precioModulo: 1490, mixModulo: 0.2 },
    { id: 'erisplus', nombre: 'Todo gratis y Eris+ a $4.990 · $34.990, sin módulos', precioCompleto: 4990, precioAnual: 34990, precioModulo: 1990, mixModulo: 0, factorConversion: 0.75 },
    { id: 'bajo', nombre: '$2.990 al mes · $24.990 al año · módulos a $1.490', precioCompleto: 2990, precioAnual: 24990, precioModulo: 1490, mixModulo: 0.3 },
    { id: 'propuesta', nombre: '$4.990 al mes · $34.990 al año · módulos a $1.990', precioCompleto: 4990, precioAnual: 34990, precioModulo: 1990, mixModulo: 0.3 },
    { id: 'alto', nombre: '$5.990 al mes · $44.990 al año · módulos a $2.490', precioCompleto: 5990, precioAnual: 44990, precioModulo: 2490, mixModulo: 0.3 },
  ];

  /**
   * Cada opción de precio con todo lo demás igual, y con la conversión más o menos sensible al precio (elasticidad baja,
   * la elegida y alta). «Deja por instalación» = lo que deja cada persona que paga × cuántos de los que instalan pagan.
   */
  function compararPrecios(p0, elasticidades) {
    var p = unir(p0), es = elasticidades || [0.2, p.elasticidad, 1.2];
    return OPCIONES_PRECIO.map(function (o) {
      var q = unir(p);
      var fc = o.factorConversion || 1;
      var mismos = o.precioCompleto === p.precioCompleto && o.precioAnual === p.precioAnual && o.mixModulo === p.mixModulo && o.precioModulo === p.precioModulo && fc === 1;
      q.precioCompleto = o.precioCompleto; q.precioAnual = o.precioAnual; q.mixModulo = o.mixModulo; q.precioModulo = o.precioModulo;
      q.conversion = p.conversion * fc;
      // Con los mismos precios del caso base, su misma mezcla (así la fila calza con el resto de la página)
      q.mixAnual = mismos ? p.mixAnual : mixAnualPorAhorro(ahorroAnual(q)) * (1 - o.mixModulo);
      var r = simular(q).resumen, v = valorPorPersona(q), conv = conversionEfectiva(q);
      return {
        id: o.id, nombre: o.nombre, precioCompleto: o.precioCompleto, precioAnual: o.precioAnual, ahorro: ahorroAnual(q), mixAnual: q.mixAnual,
        conversion: conv, deja: v.deja, porInstalacion: v.deja * conv,
        hayQuePoner: r.hayQuePoner, sePagaSola: r.sePagaSola, suscriptores: r.suscriptoresFinal, quedaFinal: r.quedaFinal,
        porElasticidad: es.map(function (e) {
          var x = unir(q); x.elasticidad = e;
          var s = simular(x).resumen;
          return { elasticidad: e, quedaFinal: s.quedaFinal, suscriptores: s.suscriptoresFinal, hayQuePoner: s.hayQuePoner, porInstalacion: valorPorPersona(x).deja * conversionEfectiva(x) };
        }),
      };
    });
  }

  var api = {
    BASE: BASE, RANGOS: RANGOS, NOMBRES: NOMBRES, PLANES_CHAT: PLANES_CHAT, unir: unir, rangoDe: rangoDe, netoDe: netoDe, porSuscripcion: porSuscripcion, capacidadPorServidor: capacidadPorServidor,
    costoSueldos: costoSueldos, duracion: duracion, valorPorPersona: valorPorPersona, suscriptoresParaCubrir: suscriptoresParaCubrir,
    factorGratis: factorGratis, costoMesPorPc: costoMesPorPc, costoPorPersona: costoPorPersona, compararChat: compararChat,
    conversionEfectiva: conversionEfectiva, ahorroAnual: ahorroAnual, mixAnualPorAhorro: mixAnualPorAhorro, compararPrecios: compararPrecios, OPCIONES_PRECIO: OPCIONES_PRECIO,
    simular: simular, monteCarlo: monteCarlo, sensibilidad: sensibilidad, azar: azar, triangular: triangular,
  };
  root.SimAXS = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
