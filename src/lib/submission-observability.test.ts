import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubmissionObservability } from './submission-observability';

describe('submission observability', () => {
  afterEach(() => vi.restoreAllMocks());

  it('isolates nonfatal failures and emits one JSON line without SyntaxError input fragments', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observation = createSubmissionObservability('applicants');
    await observation.trackTask('email', async () => { throw new SyntaxError('applicant@example.test'); });
    await observation.trackTask('sms', async () => { observation.markFailed('sms'); });
    observation.markFailed('sms');
    observation.settled();
    expect(observation.failed).toEqual(['email', 'sms']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toHaveLength(1);
    const line = String(log.mock.calls[0][0]);
    const summary = JSON.parse(line.slice(line.indexOf('{')));
    expect(summary).toMatchObject({ tasks: 2, failed: ['email', 'sms'], totalMs: expect.any(Number) });
    expect(summary.phaseMs).toMatchObject({ email: expect.any(Number), sms: expect.any(Number) });
    expect(`${line} ${error.mock.calls.flat().join(' ')}`).not.toContain('applicant@example.test');
    expect(line).not.toContain('\n');
  });

  it('timing does not swallow critical storage errors', async () => {
    const observation = createSubmissionObservability('coupang');
    await expect(observation.timed('base', async () => { throw new Error('storage failed'); })).rejects.toThrow('storage failed');
  });
});
