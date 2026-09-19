import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Commands } from "../domain/commands.ts";
import { errorPayload } from "../http/errors.ts";
import { availabilityIntervalSchema, createPollSchema, finalizeSchema } from "../http/schemas.ts";

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function toolError(error: unknown) {
  const { body } = errorPayload(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
  };
}

export function registerMcpTools(server: McpServer, commands: Commands): void {
  server.registerTool(
    "create_poll",
    {
      title: "Create poll",
      description:
        "Create a group scheduling poll from a title, duration, IANA time zone, and either concrete windows or a weekday date range. Returns a public invitation URL and a private organizer token. Does not read calendars.",
      inputSchema: createPollSchema,
    },
    async (input) => {
      try {
        return toolResult(await commands.createPoll(input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event",
      description:
        "Read poll constraints. Use publicId for the invitation view, responseToken for a participant's own response, or organizerToken for named results.",
      inputSchema: z.object({
        publicId: z.string().optional(),
        responseToken: z.string().optional(),
        organizerToken: z.string().optional(),
      }),
    },
    async (input) => {
      try {
        if (input.organizerToken) return toolResult(await commands.getOrganizerEvent(input.organizerToken));
        if (input.responseToken) return toolResult(await commands.getParticipantEvent(input.responseToken));
        if (input.publicId) return toolResult(await commands.getPublicEvent(input.publicId));
        throw new Error("Provide publicId, responseToken, or organizerToken.");
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "submit_availability",
    {
      title: "Submit availability",
      description:
        "Create a new participant response. Omitted times stay unknown unless remainderUnavailable is true. Does not book a meeting.",
      inputSchema: z.object({
        publicId: z.string(),
        name: z.string().min(1).max(80),
        intervals: z.array(availabilityIntervalSchema).default([]),
        remainderUnavailable: z.boolean().optional(),
      }),
    },
    async (input) => {
      try {
        return toolResult(await commands.submitAvailability(input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_availability",
    {
      title: "Update availability",
      description: "Revise an existing response. Requires the current responseVersion.",
      inputSchema: z.object({
        responseToken: z.string(),
        responseVersion: z.number().int().min(1),
        intervals: z.array(availabilityIntervalSchema).default([]),
        remainderUnavailable: z.boolean().optional(),
      }),
    },
    async (input) => {
      try {
        return toolResult(await commands.updateAvailability(input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "withdraw_response",
    {
      title: "Withdraw response",
      description: "Withdraw a participant response while the poll is open.",
      inputSchema: z.object({
        responseToken: z.string(),
        responseVersion: z.number().int().min(1),
      }),
    },
    async (input) => {
      try {
        return toolResult(await commands.withdrawResponse(input.responseToken, input.responseVersion));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "finalize_poll",
    {
      title: "Finalize poll",
      description:
        "Record the organizer's chosen full-duration interval against eventVersion and resultsVersion. Does not send invitations.",
      inputSchema: finalizeSchema.extend({ organizerToken: z.string() }),
    },
    async (input) => {
      try {
        return toolResult(await commands.finalize(input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "cancel_poll",
    {
      title: "Cancel poll",
      description: "Cancel a poll that is not already finalized.",
      inputSchema: z.object({ organizerToken: z.string() }),
    },
    async (input) => {
      try {
        return toolResult(await commands.cancel(input.organizerToken));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
