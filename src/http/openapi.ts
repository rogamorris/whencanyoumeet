export function openApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "When Can You Meet",
      version: "0.1.0",
      description:
        "Group scheduling poll. One domain model for humans, HTTP, and MCP. GET never mutates. Calendar access is out of scope.",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/api/polls": {
        post: {
          summary: "Create poll",
          operationId: "createPoll",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string" },
              description:
                "Replay the same create. The stored record is keyed only by this value. Same parsed body returns 201. A different parsed body returns 409 without the first organizer token.",
            },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePoll" } } },
          },
          responses: {
            "201": { description: "Created, includes organizer token once" },
            "409": { description: "Idempotency-Key reused with a different parsed body" },
          },
        },
      },
      "/api/polls/{publicId}": {
        get: {
          summary: "Public event",
          operationId: "getPublicEvent",
          parameters: [{ name: "publicId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Invitation view" } },
        },
      },
      "/api/polls/{publicId}/responses": {
        post: {
          summary: "Submit availability",
          operationId: "submitAvailability",
          parameters: [
            { name: "publicId", in: "path", required: true, schema: { type: "string" } },
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string" },
              description:
                "Replay the same submit. Same parsed body returns 201 and the original response token. A different parsed body returns 409 without the first token.",
            },
          ],
          responses: {
            "201": { description: "Includes private response token once" },
            "409": { description: "Idempotency-Key reused with a different parsed body" },
          },
        },
      },
      "/api/responses/{token}": {
        get: { summary: "Own response", operationId: "getResponse" },
        patch: {
          summary: "Update availability",
          operationId: "updateAvailability",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string" },
            },
          ],
        },
      },
      "/api/responses/{token}/withdraw": {
        post: {
          summary: "Withdraw response",
          operationId: "withdrawResponse",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string" },
            },
          ],
        },
      },
      "/api/organizer/{token}": {
        get: { summary: "Organizer results", operationId: "getOrganizerEvent" },
      },
      "/api/organizer/{token}/finalize": {
        post: { summary: "Finalize", operationId: "finalizePoll" },
      },
      "/api/organizer/{token}/update": {
        post: {
          summary: "Edit poll",
          operationId: "updateEvent",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateEvent" } } },
          },
        },
      },
      "/api/organizer/{token}/reopen": {
        post: { summary: "Reopen collection", operationId: "reopenPoll" },
      },
      "/api/organizer/{token}/cancel": {
        post: { summary: "Cancel", operationId: "cancelPoll" },
      },
      "/api/organizer/{token}/close": {
        post: { summary: "Close without a decision", operationId: "closePoll" },
      },
      "/api/organizer/{token}/delete": {
        post: { summary: "Delete poll", operationId: "deletePoll" },
      },
    },
    components: {
      schemas: {
        CreatePoll: {
          type: "object",
          required: ["title", "durationMinutes", "timezone"],
          properties: {
            title: { type: "string" },
            durationMinutes: { type: "integer" },
            timezone: { type: "string" },
            range: { type: "object" },
            windows: { type: "array" },
          },
        },
        UpdateEvent: {
          type: "object",
          required: ["eventVersion"],
          properties: {
            eventVersion: { type: "integer" },
            title: { type: "string" },
            context: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            timezone: { type: "string" },
            durationMinutes: { type: "integer" },
            windows: { type: "array" },
            range: { type: "object" },
          },
        },
        SubmitAvailability: {
          type: "object",
          required: ["name", "eventVersion"],
          properties: {
            name: { type: "string" },
            eventVersion: { type: "integer" },
            remainderUnavailable: { type: "boolean" },
            intervals: { type: "array" },
          },
        },
        UpdateAvailability: {
          type: "object",
          required: ["responseVersion", "eventVersion"],
          properties: {
            responseVersion: { type: "integer" },
            eventVersion: { type: "integer" },
            remainderUnavailable: { type: "boolean" },
            intervals: { type: "array" },
          },
        },
      },
    },
  };
}
