// ============================================================
// Eris — Interfaz Readline (Fallback para no-TTY)
// ============================================================

import * as readline from "readline";
import chalk from "chalk";
import { QueryEngine } from "./QueryEngine.js";
import type { Message } from "./types/message.js";
import { createMessage } from "./types/message.js";

const ERIS_BANNER = `
  ${chalk.magenta.bold("███████╗██████╗ ██╗███████╗")}
  ${chalk.magenta.bold("██╔════╝██╔══██╗██║██╔════╝")}
  ${chalk.magenta.bold("█████╗  ██████╔╝██║███████╗")}
  ${chalk.magenta.bold("██╔══╝  ██╔══██╗██║╚════██║")}
  ${chalk.magenta.bold("███████╗██║  ██║██║███████║")}
  ${chalk.magenta.bold("╚══════╝╚═╝  ╚═╝╚═╝╚══════╝")}
  ${chalk.gray("La Diosa del Caos")} ${chalk.gray("·")} ${chalk.magentaBright("v0.1.0")}
  ${chalk.gray.dim("Escribe tu mensaje o usa /help para comandos")}
  ${chalk.gray.dim("─────────────────────────────────────────")}
`;

export async function startReadlineUI(
  queryEngine: QueryEngine
): Promise<void> {
  const conversationHistory: Message[] = [];

  console.log(ERIS_BANNER);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const prompt = () => {
    rl.question(chalk.cyan.bold("❯ "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Slash commands
      if (trimmed.startsWith("/")) {
        const cmd = trimmed.toLowerCase();

        if (cmd === "/exit" || cmd === "/quit") {
          console.log(chalk.magenta("\n  👋 Hasta luego, Alex. El caos siempre te acompañará.\n"));
          rl.close();
          process.exit(0);
        }

        if (cmd === "/clear") {
          console.clear();
          console.log(ERIS_BANNER);
          conversationHistory.length = 0;
          prompt();
          return;
        }

        if (cmd === "/help") {
          console.log(chalk.gray(`
  ${chalk.white.bold("Comandos disponibles:")}
  ${chalk.cyan("/help")}    — Muestra esta ayuda
  ${chalk.cyan("/clear")}   — Limpia la pantalla
  ${chalk.cyan("/exit")}    — Salir de Eris

  ${chalk.white.bold("Herramientas:")}
  Eris puede ejecutar comandos del SO, buscar en la web,
  leer/escribir archivos y más. Solo pídelo en lenguaje natural.
`));
          prompt();
          return;
        }
      }

      // Agregar al historial
      const userMsg = createMessage("user", trimmed);
      conversationHistory.push(userMsg);

      // Mostrar estado
      process.stdout.write(chalk.gray.dim("  ⠋ Pensando...\r"));

      try {
        const response = await queryEngine.query(
          trimmed,
          conversationHistory,
          {
            onToolCall: (tc) => {
              process.stdout.write(
                chalk.gray(`  ⚡ Ejecutando: ${chalk.yellow(tc.name)}         \r`)
              );
            },
            onToolResult: (result) => {
              if (result.error) {
                console.log(
                  chalk.red(`  ❌ Error en ${result.name}: ${result.error}`)
                );
              } else {
                console.log(
                  chalk.green.dim(
                    `  ✅ ${result.name} completado (${result.duration}ms)`
                  )
                );
              }
            },
          }
        );

        // Limpiar línea de estado y mostrar respuesta
        process.stdout.write("                                              \r");
        console.log(
          `${chalk.magenta.bold("Eris ❯")} ${response.message.content}\n`
        );

        conversationHistory.push(response.message);
      } catch (err) {
        process.stdout.write("                                              \r");
        console.log(
          chalk.red(
            `  ❌ Error: ${err instanceof Error ? err.message : String(err)}\n`
          )
        );
      }

      prompt();
    });
  };

  prompt();

  // Mantener el proceso vivo
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
  });
}
