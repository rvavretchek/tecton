import { packageName as manifestPackage } from '@tecton/manifest';

// Fixture: allowed import (core may depend on manifest).
export const packageName = '@tecton/core';
export const allowed = manifestPackage;
