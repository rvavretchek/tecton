import { ToxiProxyContainer, type CreatedProxy, type StartedToxiProxyContainer } from '@testcontainers/toxiproxy';
import { Network, type StartedNetwork } from 'testcontainers';
import { IMAGES, withDockerCheck } from './containers.js';

/**
 * Network fault injection (Test Design ASR-2, R-09).
 *
 * Tecton has three deliberate failure postures (NFR-6): fail-closed for security
 * (token revocation, login lockout, Idempotency-Key, JWKS, Directory at login, legacy
 * bridge), fail-open for rate limiting, fail-fast for configuration. Tests put Toxiproxy
 * between the service and the dependency, then take the dependency down mid-test.
 */

export interface FaultLab {
  network: StartedNetwork;
  toxiproxy: StartedToxiProxyContainer;
  /** Creates a proxy to `upstream` (`alias:port` on the lab network); connect to the returned host/port. */
  proxy(name: string, upstream: string): Promise<CreatedProxy>;
  stop(): Promise<void>;
}

export async function startFaultLab(): Promise<FaultLab> {
  return withDockerCheck(async () => {
    const network = await new Network().start();
    const toxiproxy = await new ToxiProxyContainer(IMAGES.toxiproxy).withNetwork(network).start();
    return {
      network,
      toxiproxy,
      proxy: (name, upstream) => toxiproxy.createProxy({ name, upstream }),
      stop: async () => {
        await toxiproxy.stop();
        await network.stop();
      },
    };
  });
}

/**
 * Runs `action` with the dependency behind `proxy` unreachable, then restores it,
 * even when `action` throws.
 */
export async function withDependencyDown<T>(proxy: CreatedProxy, action: () => Promise<T>): Promise<T> {
  await proxy.setEnabled(false);
  try {
    return await action();
  } finally {
    await proxy.setEnabled(true);
  }
}
