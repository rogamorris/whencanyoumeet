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
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePoll" } } },
          },
          responses: { "201": { description: "Created, includes organizer token once" } },
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
          parameters: [{ name: "publicId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "201": { description: "Includes private response token once" } },
        },
      },
      "/api/responses/{token}": {
        get: { summary: "Own response", operationId: "getResponse" },
        patch: { summary: "Update availability", operationId: "updateAvailability" },
      },
      "/api/responses/{token}/withdraw": {
        post: { summary: "Withdraw response", operationId: "withdrawResponse" },
      },
      "/api/organizer/{token}": {
        get: { summary: "Organizer results", operationId: "getOrganizerEvent" },
      },
      "/api/organizer/{token}/finalize": {
        post: { summary: "Finalize", operationId: "finalizePoll" },
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
      },
    },
  };
}
