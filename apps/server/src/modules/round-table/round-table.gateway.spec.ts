import { describe, expect, it, vi } from 'vitest';
import { RoundTableGateway } from './round-table.gateway';

function makeService() {
  return {
    requestMic: vi.fn(async () => undefined),
    cancelRequest: vi.fn(async () => undefined),
    grantFloor: vi.fn(async () => undefined),
    revokeFloor: vi.fn(async () => undefined),
    yieldFloor: vi.fn(async () => undefined),
    sync: vi.fn(async () => undefined),
    chairSpeaking: vi.fn(async () => undefined),
    assertSessionAccess: vi.fn(async () => undefined),
    floorsForSession: vi.fn(() => []),
  };
}

const station = (stationId: string) => ({ data: { auth: { kind: 'station', stationId } }, emit: vi.fn(), join: vi.fn(), leave: vi.fn() });
const group = { sessionId: 's1', groupId: 'g1' };

describe('RoundTableGateway (security)', () => {
  it("the caller is the authenticated socket's station — a stationId in the payload is only the grant TARGET", async () => {
    const svc = makeService();
    const gw = new RoundTableGateway(svc as never);
    // A modified client claims to be the chairman and tries to hand itself the floor.
    await gw.grantFloor(station('g1-m2') as never, { ...group, stationId: 'g1-m2', callerStationId: 'g1-chair', fromStationId: 'g1-chair' });
    expect(svc.grantFloor).toHaveBeenCalledWith('g1-m2', expect.objectContaining(group), 'g1-m2');
    expect(svc.grantFloor).not.toHaveBeenCalledWith('g1-chair', expect.anything(), expect.anything());
  });

  it('ignores a socket that has not identified itself as a station', async () => {
    const svc = makeService();
    const gw = new RoundTableGateway(svc as never);
    await gw.requestMic({ data: {}, emit: vi.fn() } as never, group);
    await gw.requestMic({ data: { auth: { kind: 'user', user: { sub: 'u', role: 'TEACHER' } } }, emit: vi.fn() } as never, group);
    expect(svc.requestMic).not.toHaveBeenCalled();
  });

  it('drops a malformed payload silently', async () => {
    const svc = makeService();
    const gw = new RoundTableGateway(svc as never);
    const socket = station('g1-m1');
    await gw.requestMic(socket as never, { groupId: 42 });
    await gw.grantFloor(socket as never, group); // missing target
    await gw.chairSpeaking(socket as never, { ...group, speaking: 'yes' });
    expect(svc.requestMic).not.toHaveBeenCalled();
    expect(svc.grantFloor).not.toHaveBeenCalled();
    expect(svc.chairSpeaking).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('a rule violation goes back to the caller only, as rt:error', async () => {
    const svc = makeService();
    svc.grantFloor.mockRejectedValueOnce(new Error('Only the chairman can give the floor'));
    const gw = new RoundTableGateway(svc as never);
    const socket = station('g1-m2');
    await gw.grantFloor(socket as never, { ...group, stationId: 'g1-m1' });
    expect(socket.emit).toHaveBeenCalledWith('rt:error', { groupId: 'g1', message: 'Only the chairman can give the floor' });
  });

  it('rt:watch needs a dashboard user with access; a station cannot subscribe', async () => {
    const svc = makeService();
    const gw = new RoundTableGateway(svc as never);
    const stationSocket = station('g1-m1');
    await gw.watch(stationSocket as never, { sessionId: 's1' });
    expect(stationSocket.join).not.toHaveBeenCalled();

    const teacherSocket = { data: { auth: { kind: 'user', user: { sub: 't', role: 'TEACHER' } } }, emit: vi.fn(), join: vi.fn(), leave: vi.fn() };
    svc.assertSessionAccess.mockRejectedValueOnce(new Error('not your batch'));
    await gw.watch(teacherSocket as never, { sessionId: 's1' });
    expect(teacherSocket.join).not.toHaveBeenCalled();

    await gw.watch(teacherSocket as never, { sessionId: 's1' });
    expect(teacherSocket.join).toHaveBeenCalledWith('rt:s1');
  });
});
