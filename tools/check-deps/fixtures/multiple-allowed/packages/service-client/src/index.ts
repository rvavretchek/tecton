import { packageName as providers } from '@tecton/providers';
import { packageName as core } from '@tecton/core';

// Fixture: providers is allowed for service-client, core is not.
export const packageName = '@tecton/service-client';
export const used = [providers, core];
