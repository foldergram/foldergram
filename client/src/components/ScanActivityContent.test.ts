import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../locales';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import type { AppStatus, ScanRunSummary } from '../types/api';
import ScanActivityContent from './ScanActivityContent.vue';

const { acknowledgeScanIssuesMock } = vi.hoisted(() => ({ acknowledgeScanIssuesMock: vi.fn() }));
vi.mock('../api/gallery', async importOriginal => ({
  ...await importOriginal<typeof import('../api/gallery')>(),
  acknowledgeScanIssues: acknowledgeScanIssuesMock
}));

const completed: ScanRunSummary = {
  id: 22, started_at: '2026-11-16T14:01:22.260Z', finished_at: '2026-11-16T14:01:22.288Z',
  status: 'completed', scanned_files: 70, new_files: 0, updated_files: 0, removed_files: 0,
  error_text: null, warning_count: 0, warning_text: null
};
const interrupted: ScanRunSummary = {
  ...completed, id: 2, started_at: '2026-09-03T14:06:46.139Z', finished_at: '2026-11-16T03:06:21.582Z',
  status: 'failed', error_text: 'Scan interrupted by server restart. Run a scan to continue.'
};
const olderInterrupted = { ...interrupted, id: 1, started_at: '2026-09-03T14:02:23.321Z' };

function showActivity(issues: ScanRunSummary[], latest = completed) {
  const store = useAppStore();
  store.stats = { scan: { isScanning: false, lastCompletedScan: latest, recentIssues: issues } } as AppStatus;
  return {
    store,
    wrapper: mount(ScanActivityContent, { global: { stubs: { RouterLink: RouterLinkStub } } })
  };
}

describe('ScanActivityContent results', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    window.sessionStorage.clear();
    acknowledgeScanIssuesMock.mockReset().mockResolvedValue({ ok: true });
    i18n.global.locale.value = 'en';
  });

  it('shows a successful latest scan separately from earlier interrupted scans', () => {
    const { wrapper } = showActivity([interrupted, olderInterrupted]);
    expect(wrapper.text()).toContain('Scan completed.');
    expect(wrapper.text()).toContain('Earlier scan needs attention');
    expect(wrapper.text()).toContain('2 scans reported this issue.');
    expect(wrapper.find('time').attributes('datetime')).toBe(interrupted.started_at);
    wrapper.unmount();
  });

  it('acknowledges displayed failures after saving and retains the latest success', async () => {
    const { store, wrapper } = showActivity([interrupted, olderInterrupted]);
    expect(wrapper.get('button').text()).toBe('Acknowledge 2 results');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    store.updateScanProgress({ ...store.stats!.scan, recentIssues: [{ ...interrupted }, { ...olderInterrupted }] });
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.unmount();

    window.sessionStorage.clear();
    setActivePinia(createPinia());
    const reloaded = showActivity([]);
    expect(reloaded.wrapper.find('button').exists()).toBe(false);
    expect(reloaded.wrapper.text()).toContain('Scan completed.');
    reloaded.wrapper.unmount();
  });

  it('keeps failed acknowledgements visible and explains that saving can be retried', async () => {
    acknowledgeScanIssuesMock.mockRejectedValueOnce(new Error('Save failed'));
    const { wrapper } = showActivity([interrupted]);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not save the acknowledgement. Please try again.');
    expect(wrapper.text()).toContain('Earlier scan needs attention');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('disables the acknowledgement button while saving', async () => {
    const saved = Promise.withResolvers<{ ok: boolean }>();
    acknowledgeScanIssuesMock.mockReturnValue(saved.promise);
    const { wrapper } = showActivity([interrupted]);
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Earlier scan needs attention');
    saved.resolve({ ok: true });
    await flushPromises();
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not offer a persistent acknowledgement in public demo mode', () => {
    useAuthStore().publicDemoMode = true;
    const { wrapper } = showActivity([interrupted]);
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not repeat the latest failure in its result and attention sections', () => {
    const { wrapper } = showActivity([interrupted, olderInterrupted], interrupted);
    expect(wrapper.text().match(/Scan could not finish\./g)).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Earlier scan needs attention');
    wrapper.unmount();
  });
});
