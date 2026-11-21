import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestJson } from '../api/http';
import VideoPreviewReclamation from './VideoPreviewReclamation.vue';

vi.mock('../api/http', async importOriginal => ({
  ...await importOriginal<typeof import('../api/http')>(), requestJson: vi.fn()
}));

enableAutoUnmount(afterEach);
beforeEach(() => vi.mocked(requestJson).mockReset());

const sources = [{ id: 1, name: 'Primary gallery' }];
const readyJob = {
  id: 'leftover-preview', state: 'ready', sources, confirmed: false, cancelRequested: false,
  assessment: { checked: 1, videos: 0, files: 1, bytes: 12_000, skipped: 0, reasons: {} },
  result: { switched: 0, files: 0, bytes: 0, skipped: 0, deferred: 0, failed: 0, reasons: {} }
};

function mountCard(job: object | null = null) {
  vi.mocked(requestJson).mockResolvedValueOnce({ sources, job, cleanupPending: false });
  const wrapper = mount(VideoPreviewReclamation, {
    props: { mode: 'streaming', canStart: true }, attachTo: document.body
  });
  const button = (label: string) => {
    const match = wrapper.findAll('button').find(item => item.text() === label);
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
  };
  const panel = () => wrapper.find('section[aria-labelledby]');
  return { wrapper, button, panel };
}

describe('VideoPreviewReclamation optional assessment', () => {
  it('closes the empty panel and returns keyboard focus to its opener', async () => {
    const { button, panel } = mountCard();
    await flushPromises();
    await button('Check for remaining previews').trigger('click');
    expect(panel().exists()).toBe(true);
    await button('Close').trigger('click');
    expect(panel().exists()).toBe(false);
    expect(document.activeElement).toBe(button('Check for remaining previews').element);
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('closes an assessment with candidates and allows another explicit assessment', async () => {
    const { button, panel } = mountCard();
    await flushPromises();
    vi.mocked(requestJson).mockResolvedValueOnce(readyJob);
    await button('Check for remaining previews').trigger('click');
    await button('Assess previews').trigger('click');
    await flushPromises();
    expect(panel().text()).toContain('Previews to remove');
    await button('Close').trigger('click');
    expect(panel().exists()).toBe(false);
    expect(document.activeElement).toBe(button('Check for remaining previews').element);
    expect(requestJson).toHaveBeenCalledTimes(2);

    await button('Check for remaining previews').trigger('click');
    vi.mocked(requestJson).mockResolvedValueOnce(readyJob);
    await button('Assess previews').trigger('click');
    await flushPromises();
    expect(panel().text()).toContain('Previews to remove');
    expect(requestJson).toHaveBeenCalledTimes(3);
  });

  it('can close a ready assessment restored from the server without mutating it', async () => {
    const { button, panel } = mountCard(readyJob);
    await flushPromises();
    expect(panel().text()).toContain('Previews to remove');
    await button('Close').trigger('click');
    expect(panel().exists()).toBe(false);
    expect(document.activeElement).toBe(button('Check for remaining previews').element);
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('closes an assessment error and allows a fresh attempt', async () => {
    const { wrapper, button, panel } = mountCard();
    await flushPromises();
    vi.mocked(requestJson).mockRejectedValueOnce(new Error('Assessment unavailable'));
    await button('Check for remaining previews').trigger('click');
    await button('Assess previews').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Assessment unavailable');
    await button('Close').trigger('click');
    expect(panel().exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await button('Check for remaining previews').trigger('click');
    expect(button('Assess previews').attributes('disabled')).toBeUndefined();
  });

  it('waits for an in-flight assessment before allowing Close', async () => {
    const { button, panel } = mountCard();
    await flushPromises();
    let finish!: (job: typeof readyJob) => void;
    vi.mocked(requestJson).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await button('Check for remaining previews').trigger('click');
    await button('Assess previews').trigger('click');
    expect(button('Close').attributes('disabled')).toBeDefined();
    await button('Close').trigger('click');
    expect(panel().exists()).toBe(true);
    finish(readyJob);
    await flushPromises();
    await button('Close').trigger('click');
    expect(panel().exists()).toBe(false);
  });

  it.each(['running', 'interrupted', 'complete'])('keeps %s maintenance jobs available instead of offering Close', async state => {
    const { wrapper, button, panel } = mountCard({ ...readyJob, state, confirmed: true,
      result: { ...readyJob.result, failed: state === 'complete' ? 1 : 0 } });
    await flushPromises();
    expect(panel().exists()).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Close')).toBe(false);
    expect(button(state === 'running' ? 'Cancel operation' : 'Resume or retry').exists()).toBe(true);
  });
});
