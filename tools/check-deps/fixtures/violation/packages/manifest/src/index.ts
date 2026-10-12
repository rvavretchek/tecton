import { packageName as corePackage } from '@tecton/core';

// Fixture: forbidden import (manifest must not depend on any other @tecton package).
export const packageName = '@tecton/manifest';
export const forbidden = corePackage;
