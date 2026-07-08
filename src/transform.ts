// Ping events forwarded to Mixpanel
export const ASSERTION_TYPES = ['ASSERTION.CHECK_SUCCESS', 'ASSERTION.CHECK_FAILED'];

export function isAssertionEvent(event: any): boolean {
  return ASSERTION_TYPES.includes(event?.action?.type);
}

// transform a Ping log  into a Mixpanel /import event body.

export function transformToMixpanel(event: any) {
  const user = event.actors.user;
  const app = event.resources[0];

  return {
    event: event.action.type,
    properties: {
      // Mixpanel required fields
      time: Math.floor(Date.parse(event.recordedAt) / 1000),
      distinct_id: user.id, // Ping id
      $insert_id: event.id, // stable Ping event id doubles as the dedup key

      // requested attributes
      environment_id: app.environment.id,
      environment_name: app.environment.name ?? null, // not present on current payloads
      user_ping_id: user.id,
      user_name: user.name,
      action_type: event.action.type,
      action_description: event.action.description,
      resource_name: app.name,
      resource_id: app.id,
      result_status: event.result.status,
      ping_timestamp: event.recordedAt,
      correlation_id: event.correlationId
    }
  };
}
