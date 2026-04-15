// ============================================================
// Eris — Componente principal de la App (CLI)
// ============================================================

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { Banner } from "./Banner.js";
import { Spinner } from "./Spinner.js";
import type { Message, ToolResult } from "../types/message.js";
import { createMessage } from "../types/message.js";
import { QueryEngine } from "../QueryEngine.js";

interface AppProps {
  queryEngine: QueryEngine;
}

export function App({ queryEngine }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [showBanner, setShowBanner] = useState(true);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isProcessing) return;

      // Ocultar banner después del primer mensaje
      if (showBanner) setShowBanner(false);

      // Comandos slash
      if (trimmed.startsWith("/")) {
        const cmd = trimmed.toLowerCase();
        if (cmd === "/exit" || cmd === "/quit") {
          exit();
          return;
        }
        if (cmd === "/clear") {
          setMessages([]);
          setInputValue("");
          setShowBanner(true);
          return;
        }
        if (cmd === "/help") {
          const helpMsg = createMessage(
            "system",
            "## Comandos disponibles\n" +
              "- `/help` — Muestra esta ayuda\n" +
              "- `/clear` — Limpia la pantalla\n" +
              "- `/exit` — Salir de Eris\n\n" +
              "## Herramientas\n" +
              "Eris puede ejecutar comandos del SO, buscar en la web, leer/escribir archivos y más.\n" +
              "Solo pídelo en lenguaje natural."
          );
          setMessages((prev) => [...prev, helpMsg]);
          setInputValue("");
          return;
        }
      }

      // Agregar mensaje del usuario
      const userMsg = createMessage("user", trimmed);
      setMessages((prev) => [...prev, userMsg]);
      setInputValue("");
      setIsProcessing(true);
      setStatusText("Pensando...");

      try {
        const response = await queryEngine.query(trimmed, messages, {
          onToolCall: (tc) => {
            setStatusText(`🔧 Ejecutando: ${tc.name}`);
            const toolMsg = createMessage(
              "system",
              `⚡ Ejecutando herramienta: **${tc.name}**`
            );
            setMessages((prev) => [...prev, toolMsg]);
          },
          onToolResult: (result: ToolResult) => {
            const resultContent = result.error
              ? `❌ Error en ${result.name}: ${result.error}`
              : `✅ ${result.name} completado (${result.duration}ms)`;
            const resultMsg = createMessage("system", resultContent);
            setMessages((prev) => [...prev, resultMsg]);
          },
        });

        setMessages((prev) => [...prev, response]);
      } catch (err) {
        const errorMsg = createMessage(
          "system",
          `❌ Error: ${err instanceof Error ? err.message : String(err)}`
        );
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsProcessing(false);
        setStatusText("");
      }
    },
    [isProcessing, messages, queryEngine, exit, showBanner]
  );

  return (
    <Box flexDirection="column" padding={1}>
      {/* Banner */}
      {showBanner && <Banner />}

      {/* Messages */}
      <Box flexDirection="column" marginBottom={1}>
        {messages.slice(-20).map((msg) => (
          <Box key={msg.id} marginBottom={0}>
            {msg.role === "user" && (
              <Text>
                <Text color="cyan" bold>
                  Alex ❯{" "}
                </Text>
                <Text>{msg.content}</Text>
              </Text>
            )}
            {msg.role === "assistant" && (
              <Text>
                <Text color="magenta" bold>
                  Eris ❯{" "}
                </Text>
                <Text>{msg.content}</Text>
              </Text>
            )}
            {msg.role === "system" && (
              <Text color="gray" dimColor>
                {"     "}{msg.content}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Spinner */}
      {isProcessing && (
        <Box marginBottom={0}>
          <Spinner label={statusText} />
        </Box>
      )}

      {/* Input */}
      <Box>
        <Text color="cyan" bold>
          ❯{" "}
        </Text>
        <TextInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          placeholder={isProcessing ? "Esperando respuesta..." : "Escribe tu mensaje..."}
          isDisabled={isProcessing}
        />
      </Box>
    </Box>
  );
}
