import { cloudEventType } from './events.js';
import type { TectonManifest } from './types.js';

export interface AsyncApiOptions {
  /**
   * Payload schema of an event consumed from another domain, when known (e.g. from the lint
   * index). Without it the payload is a generic object pointing to the origin manifest.
   */
  resolveEvent?: (domain: string, event: string) => Record<string, unknown> | undefined;
}

type Message = Record<string, unknown>;

/** PascalCase of a kebab-case domain (`leave-requests` -> `LeaveRequests`), for operation ids. */
function pascal(domain: string): string {
  return domain
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * AsyncAPI 3.0 document of a domain, derived from its events (FR-5). One channel per origin
 * domain (each domain publishes to a single stream, FR-21); a `send` operation per published
 * event and a `receive` operation per consumed event.
 */
export function buildAsyncApiDocument(manifest: TectonManifest, options: AsyncApiOptions = {}): Record<string, unknown> {
  const channels: Record<string, { address: string; messages: Record<string, { $ref: string }> }> = {};
  const messages: Record<string, Message> = {};
  const operations: Record<string, unknown> = {};

  const channel = (domain: string) => (channels[domain] ??= { address: `tecton.${domain}`, messages: {} });

  for (const event of manifest.events.publishes) {
    channel(manifest.domain).messages[event.name] = { $ref: `#/components/messages/${event.name}` };
    messages[event.name] = {
      name: event.name,
      title: event.name,
      ...(event.description ? { summary: event.description } : {}),
      contentType: 'application/json',
      payload: event.payloadSchema,
      'x-cloudevents-type': event.type,
    };
    operations[`send${event.name}`] = {
      action: 'send',
      channel: { $ref: `#/channels/${manifest.domain}` },
      messages: [{ $ref: `#/channels/${manifest.domain}/messages/${event.name}` }],
    };
  }

  for (const reference of manifest.events.consumes) {
    const [domain = '', event = ''] = reference.split('.');
    const own = domain === manifest.domain && messages[event] !== undefined;
    const messageId = own ? event : reference;
    if (!own) {
      messages[messageId] = {
        name: event,
        title: `${domain}.${event}`,
        contentType: 'application/json',
        payload: options.resolveEvent?.(domain, event) ?? {
          type: 'object',
          description: `Payload defined by the ${domain} manifest (event ${event}).`,
        },
        'x-cloudevents-type': cloudEventType(domain, event),
      };
    }
    channel(domain).messages[event] = { $ref: `#/components/messages/${messageId}` };
    operations[`receive${pascal(domain)}${event}`] = {
      action: 'receive',
      channel: { $ref: `#/channels/${domain}` },
      messages: [{ $ref: `#/channels/${domain}/messages/${event}` }],
    };
  }

  return {
    asyncapi: '3.0.0',
    info: { title: manifest.domain, version: manifest.version, description: manifest.description },
    defaultContentType: 'application/json',
    channels,
    operations,
    components: { messages },
  };
}
