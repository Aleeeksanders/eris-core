import { RESTRICTION_IDS } from "../services/DietaryRestrictions.js";
import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import type { UserProfile } from "../memory.js";
import { humanSchedule } from "../services/LiveContext.js";

// Zod schemas para los subtipos del perfil médico
const MedicalConditionSchema = z.object({
  id: z.enum([
    'diabetes_t1', 'diabetes_t2', 'prediabetes',
    'hypertension', 'hypotension',
    'hypothyroidism', 'hyperthyroidism',
    'obesity', 'dyslipidemia',
    'asthma', 'copd',
    'ckd', 'heart_failure',
    'celiac', 'ibs',
    'depression', 'anxiety',
    'other'
  ]),
  diagnosedDate: z.string().optional().describe("YYYY-MM-DD"),
  notes: z.string().optional(),
});

const MedicationSchema = z.object({
  id: z.string().optional().describe("No enviar al crear; el sistema lo asignará"),
  name: z.string(),
  type: z.enum([
    'insulin_rapid', 'insulin_long', 'insulin_mixed',
    'metformin', 'sglt2', 'glp1', 'dpp4', 'sulfonylurea',
    'antihypertensive', 'diuretic', 'beta_blocker',
    'levothyroxine', 'statin',
    'antidepressant', 'anxiolytic',
    'other'
  ]),
  dose: z.string().optional(),
  schedule: z.string().optional(),
  active: z.boolean(),
});

const AlertThresholdsSchema = z.object({
  glucoseLow: z.number().optional(),
  glucoseHigh: z.number().optional(),
  glucoseUrgentLow: z.number().optional(),
  glucoseUrgentHigh: z.number().optional(),
  systolicHigh: z.number().optional(),
  diastolicHigh: z.number().optional(),
});

const MedicalProfileUpdateSchema = z.object({
  conditions: z.array(MedicalConditionSchema).optional().describe("Lista COMPLETA de condiciones (sobrescribe la anterior). Incluye las nuevas y las que ya existían."),
  medications: z.array(MedicationSchema).optional().describe("Lista COMPLETA de medicamentos (sobrescribe la anterior)."),
  thresholds: AlertThresholdsSchema.optional().describe("Umbrales de alertas médicas (glucosa, presión). Solo enviar los campos a actualizar."),
  bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  allergies: z.string().optional().describe("Alergias del usuario (texto libre)"),
  dietaryRestrictions: z.array(z.enum(RESTRICTION_IDS)).optional().describe(
    "Dietas y restricciones alimentarias del usuario (lista COMPLETA, sobrescribe la anterior): vegetariano, vegano, pescetariano, keto, bajo_carbos, embarazo, sin_cerdo, sin_alcohol, sin_gluten, sin_lactosa, sin_frutos_secos, sin_mani, sin_mariscos, sin_pescado, sin_huevo, sin_soya, sin_sesamo, sin_mostaza, sin_apio, sin_sulfitos, sin_lupino. " +
    "Úsala cuando el usuario diga 'soy vegano', 'estoy en keto', 'estoy embarazada', 'no como cerdo'… Eris respetará esto en TODAS sus recomendaciones de comida.",
  ),
});

const ProfileManagementInputSchema = z.object({
  action: z.enum(["get", "update"]).describe("Si debes LEER el perfil o ACTUALIZARLO."),
  displayName: z.string().optional().describe("Actualizar nombre del usuario"),
  goals: z.string().optional().describe("Actualizar objetivos principales del usuario"),
  customContext: z.string().optional().describe("Contexto personal PERMANENTE (trabajo, rutina, preferencias). NUNCA datos de un día: el sueño de anoche va en sleep_log; comida y agua, en nutrition_tracker."),
  medical: MedicalProfileUpdateSchema.optional().describe("Actualizar el perfil médico. IMPORTANTE: para conditions y medications, debes enviar el array COMPLETO incluyendo lo que ya tenía el usuario."),
});

type ProfileManagementInput = z.infer<typeof ProfileManagementInputSchema>;

/** ¿El texto es un dato de UN día (sueño de anoche, lo comido o tomado hoy) en vez de contexto permanente? */
export function dailyDataIn(text: unknown): "sueño" | "comida o agua" | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(sueno|dormi\w*|dormido)\b[^.\n]{0,60}\d|\d[^.\n]{0,20}\bhoras? de sueno\b/.test(t)) return "sueño";
  if (/\b(hoy|anoche|esta manana|este dia)\b/.test(t) && /\b(comi\w*|tome|agua|litros?|kcal|calorias|hidrat\w*|ml)\b/.test(t) && /\d/.test(t)) return "comida o agua";
  return null;
}

export class ProfileManagementTool extends Tool<ProfileManagementInput> {
  readonly name = "manage_user_profile";
  readonly dangerous = true;
  readonly description = 
    "Herramienta que te otorga CONTROL TOTAL sobre el perfil permanente y médico del usuario. " +
    "Úsala para recordar a largo plazo condiciones médicas, medicamentos, alergias, objetivos o contexto personal. " +
    "Si el usuario te dice 'Tengo hipertensión', 'Soy alérgico al maní', o 'Quiero bajar 5kg', " +
    "DEBES usar esta herramienta con action='update' para guardar esa información en su perfil y nunca olvidarla. " +
    "Cuando actualices arrays como conditions o medications, asegúrate de hacer un 'get' primero si no conoces su estado actual " +
    "para evitar sobrescribir y borrar sus condiciones previas. " +
    "NO es para datos de un día (horas dormidas anoche, lo que comió o tomó hoy): eso va en sleep_log o nutrition_tracker.";

  readonly inputSchema = ProfileManagementInputSchema;

  async execute(input: ProfileManagementInput, context?: any): Promise<ToolExecutionResult> {
    if (!context?.memory) {
      return { output: "", error: "No hay memoria activa en este contexto." };
    }

    const memory = context.memory;
    const currentProfile: UserProfile = (await memory.getProfile()) || { displayName: "Usuario" };

    if (input.action === "get") {
      // Sin credenciales: las integraciones (contraseñas de LibreView, etc.) nunca deben pasar por el chat ni por el modelo
      const log: any[] = (await memory.get("profile_change_log").catch(() => null)) || [];
      const recent = Array.isArray(log) && log.length ? "\n\nÚltimos cambios al perfil hechos por Eris:\n" + log.slice(-5).map((e) => `- ${e.at}: ${e.changed.join(", ")}`).join("\n") : "";
      // "schedule": "Mañana" es la jornada ("por la mañana"), no el día siguiente: Eris lo leyó como "a tomar mañana a las 7"
      const medical = currentProfile.medical
        ? { ...currentProfile.medical, medications: currentProfile.medical.medications?.map((m: any) => (m.schedule ? { ...m, schedule: humanSchedule(m.schedule) } : m)) }
        : currentProfile.medical;
      return { output: JSON.stringify({ ...currentProfile, medical, integrations: undefined }, null, 2) + recent };
    }

    if (input.action === "update") {
      // Datos de un día como nota permanente: el 2026-10-07 "dormí 7 horas" quedó como "Sueño: 7 horas" en el perfil (y en el
      // prompt de Eris, para siempre). Se rechaza y se indica la herramienta correcta.
      const daily = dailyDataIn(input.customContext);
      if (daily) return { output: "", error: `Eso es un dato del día (${daily}), no del perfil: el perfil es solo para lo permanente. ${daily === "sueño" ? "Usa sleep_log para anotar las horas de esa noche." : "Usa nutrition_tracker para la comida y el agua de hoy."} No le digas al usuario que lo guardaste en el perfil.` };
      // Foto ANTES del cambio de lo que más importa (salud y contexto persistente): así un cambio malo se ve y se puede revertir
      const before = {
        allergies: currentProfile.medical?.allergies,
        dietaryRestrictions: currentProfile.medical?.dietaryRestrictions,
        conditions: currentProfile.medical?.conditions?.map((c: any) => c.id),
        medications: currentProfile.medical?.medications?.map((m: any) => `${m.name}${m.active ? "" : " (inactivo)"}`),
        customContext: currentProfile.customContext,
        goals: currentProfile.goals,
      };
      if (input.displayName !== undefined) currentProfile.displayName = input.displayName;
      if (input.goals !== undefined) currentProfile.goals = input.goals;
      if (input.customContext !== undefined) currentProfile.customContext = input.customContext;
      
      if (input.medical) {
        if (!currentProfile.medical) {
          currentProfile.medical = { conditions: [], medications: [], thresholds: { glucoseLow: 70, glucoseHigh: 180, glucoseUrgentLow: 55, glucoseUrgentHigh: 250 } };
        }
        
        if (input.medical.conditions) {
          currentProfile.medical.conditions = input.medical.conditions as any;
        }
        
        if (input.medical.medications) {
          // Asignar IDs a medicamentos nuevos
          currentProfile.medical.medications = input.medical.medications.map((m: any) => ({
            ...m,
            id: m.id || crypto.randomUUID(),
          })) as any;
        }
        
        if (input.medical.thresholds) {
          currentProfile.medical.thresholds = {
            ...currentProfile.medical.thresholds,
            ...input.medical.thresholds
          };
        }
        
        if (input.medical.bloodType !== undefined) currentProfile.medical.bloodType = input.medical.bloodType as any;
        if (input.medical.allergies !== undefined) currentProfile.medical.allergies = input.medical.allergies;
        if (input.medical.dietaryRestrictions !== undefined) currentProfile.medical.dietaryRestrictions = input.medical.dietaryRestrictions;
      }

      const changed = ["displayName", "goals", "customContext"].filter((k) => (input as any)[k] !== undefined)
        .concat(Object.keys(input.medical ?? {}).filter((k) => (input.medical as any)[k] !== undefined).map((k) => `medical.${k}`));
      try {
        const log: any[] = (await memory.get("profile_change_log").catch(() => null)) || [];
        log.push({ at: new Date().toISOString(), changed, before });
        await memory.set("profile_change_log", log.slice(-30));
      } catch { /* la bitácora nunca debe impedir guardar */ }

      await memory.saveProfile(currentProfile);

      return {
        output: "Perfil actualizado exitosamente. El sistema recordará esto permanentemente.\nNuevo perfil:\n" + JSON.stringify({ ...currentProfile, integrations: undefined }, null, 2)
      };
    }

    return { output: "", error: "Acción no reconocida." };
  }
}
