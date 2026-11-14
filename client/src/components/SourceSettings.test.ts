import { createPinia, setActivePinia } from 'pinia';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import SourceSettings from './SourceSettings.vue';

vi.mock('../api/http', () => ({ requestJson: vi.fn() }));
const request = vi.mocked(requestJson);
const emptySelection = () => ({ mode: 'folders', roots: [], albumIds: [], exclusions: [], includeUnfiled: false, allowOriginals: false, intervalMinutes: 0 });
const content = () => ({
    version: '3.3.5', assetCount: 3, uploadCount: 1, warnings: [] as string[], suggestedMode: 'both',
    libraries: [{ id: 'lib', name: 'Photos', importPaths: ['/photos', '/other'] }],
    roots: [{ libraryId: 'lib', path: '/photos/holiday', count: 2 }],
    albums: [{ id: 'holiday', albumName: 'Holiday', shared: false }, { id: 'family', albumName: 'Family', shared: true }]
});
const savedSource = (overrides = {}) => ({
    id: 1, name: 'Immich', server_url: 'http://immich:2283', managed_by: 'settings', enabled: 1,
    status: 'ready', asset_count: 237, folder_count: 15, selection: emptySelection(),
    last_success: null, last_error: null, syncing: false, progress: 0, ...overrides
});
let sources: ReturnType<typeof savedSource>[];
let discovery: ReturnType<typeof content>;
let wrapper: ReturnType<typeof mount> | undefined;
const button = (text: string) => wrapper!.findAll('button').find(b => b.text() === text)!;
const folderChecks = () => wrapper!.findAll('[data-test="folder-selection"] input[type="checkbox"]');
const albumChecks = () => wrapper!.findAll('[data-test="album-selection"] input[type="checkbox"]');
const isChecked = (checkbox: ReturnType<typeof folderChecks>[number]) => (checkbox.element as HTMLInputElement).checked;
const savedBody = (method = 'POST') => JSON.parse(request.mock.calls.find(([url, init]) => url === (method === 'POST' ? '/api/admin/sources' : '/api/admin/sources/1') && init?.method === method)![1]!.body as string);

async function openConnection() {
    wrapper = mount(SourceSettings);
    await flushPromises();
    await button('Connect Immich').trigger('click');
    await wrapper.find('input[type="url"]').setValue('http://immich:2283');
    await wrapper.find('input[type="password"]').setValue('fixture-key');
}
async function connect() {
    await openConnection();
    await wrapper!.find('form').trigger('submit');
    await flushPromises();
}

beforeEach(() => {
    setActivePinia(createPinia());
    sources = [];
    discovery = content();
    request.mockReset();
    request.mockImplementation(async (url, init) => {
        if (url === '/api/admin/sources/immich/test') return discovery;
        if (init?.method === 'POST' || init?.method === 'PATCH') return savedSource();
        return { items: sources };
    });
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

describe('Immich source settings', () => {
    it('waits for saved sources before rendering the empty connection state', async () => {
        let resolveSources!: (value: unknown) => void;
        request.mockImplementationOnce(() => new Promise(resolve => { resolveSources = resolve; }));
        wrapper = mount(SourceSettings);
        await flushPromises();
        expect(wrapper.text()).toContain('Loading sources…');
        expect(wrapper.text()).not.toContain('Connect your Immich library');
        expect(button('Connect Immich')).toBeUndefined();
        resolveSources({ items: [savedSource()] });
        await flushPromises();
        expect(wrapper.text()).toContain('Connected');
        expect(wrapper.text()).not.toContain('Connect your Immich library');
        expect(wrapper.text()).not.toContain('Loading sources…');
    });

    it('offers a retry after a load failure without claiming no sources are connected', async () => {
        request.mockRejectedValueOnce(new Error('Could not reach Foldergram.'));
        wrapper = mount(SourceSettings);
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toContain('Could not reach Foldergram.');
        expect(wrapper.text()).not.toContain('Connect your Immich library');
        expect(button('Connect Immich')).toBeUndefined();
        sources = [savedSource()];
        await button('Try again').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('Connected');
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('starts with a simple connect action and keeps local-folder guidance expandable', async () => {
        wrapper = mount(SourceSettings);
        await flushPromises();
        expect(wrapper.text()).toContain('Connect your Immich library');
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        expect(wrapper.find('input').exists()).toBe(false);
        expect(wrapper.find('details').attributes('open')).toBeUndefined();
    });

    it('shows only the URL and key before connecting, and does not save during discovery', async () => {
        await openConnection();
        expect(wrapper!.findAll('input')).toHaveLength(2);
        expect(wrapper!.findAll('input[type="radio"]')).toHaveLength(0);
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.some(([url, init]) => url === '/api/admin/sources' && init?.method === 'POST')).toBe(false);
    });

    it('preselects every folder and album, suggests a mode, and saves only on the final action', async () => {
        await connect();
        expect(isChecked(wrapper!.find('input[value="both"]'))).toBe(true);
        expect(folderChecks().map(isChecked)).toEqual([true, true]);
        expect(albumChecks().map(isChecked)).toEqual([true, true]);
        expect(wrapper!.text()).toContain('2 folders · 2 albums selected');
        expect(wrapper!.find('[data-test="customize-selection"]').attributes('open')).toBeUndefined();
        expect(wrapper!.find('[data-test="advanced-options"]').attributes('open')).toBeUndefined();
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(savedBody()).toMatchObject({
            apiKey: 'fixture-key', name: 'Immich',
            selection: { mode: 'both', roots: [{ libraryId: 'lib', path: '/photos' }, { libraryId: 'lib', path: '/other' }], albumIds: ['holiday', 'family'], includeUnfiled: false }
        });
        expect(wrapper!.find('form').exists()).toBe(false);
        await button('Connect Immich').trigger('click');
        expect((wrapper!.find('input[type="password"]').element as HTMLInputElement).value).toBe('');
    });

    it('excludes unchecked folders and albums from the saved selection', async () => {
        await connect();
        await folderChecks()[0].setValue(false);
        await albumChecks()[1].setValue(false);
        expect(wrapper!.text()).toContain('1 folder · 1 album selected');
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(savedBody().selection).toMatchObject({ roots: [{ libraryId: 'lib', path: '/other' }], albumIds: ['holiday'] });
    });

    it('preserves exclusions and the chosen mode when rechecking a new connection', async () => {
        await connect();
        await albumChecks()[0].setValue(false);
        await wrapper!.find('input[value="albums"]').setValue(true);
        await button('Change').trigger('click');
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(isChecked(wrapper!.find('input[value="albums"]'))).toBe(true);
        expect(albumChecks().map(isChecked)).toEqual([false, true]);
    });

    it('starts a fresh selection when the server URL changes', async () => {
        await connect();
        await albumChecks()[0].setValue(false);
        await button('Change').trigger('click');
        await wrapper!.find('input[type="url"]').setValue('http://another-immich:2283');
        discovery = { ...content(), suggestedMode: 'albums', libraries: [], roots: [], albums: [{ id: 'new-album', albumName: 'New server', shared: false }] };
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(savedBody().selection).toMatchObject({ mode: 'albums', roots: [], albumIds: ['new-album'] });
    });

    it('shows only the active mode and restores checks when switching back', async () => {
        await connect();
        await folderChecks()[0].setValue(false);
        await wrapper!.find('input[value="albums"]').setValue(true);
        expect(folderChecks()).toHaveLength(0);
        expect(wrapper!.text()).toContain('2 albums selected');
        await wrapper!.find('input[value="folders"]').setValue(true);
        expect(albumChecks()).toHaveLength(0);
        expect(folderChecks().map(isChecked)).toEqual([false, true]);
    });

    it('prevents an empty import and supports bulk selection', async () => {
        await connect();
        await button('Deselect all folders').trigger('click');
        await button('Deselect all albums').trigger('click');
        expect(button('Connect and sync').attributes('disabled')).toBeDefined();
        await wrapper!.find('form').trigger('submit');
        expect(request.mock.calls.some(([url, init]) => url === '/api/admin/sources' && init?.method === 'POST')).toBe(false);
        await button('Select all albums').trigger('click');
        expect(button('Connect and sync').attributes('disabled')).toBeUndefined();
        expect(albumChecks().map(isChecked)).toEqual([true, true]);
        await button('Select all folders').trigger('click');
        expect(folderChecks().map(isChecked)).toEqual([true, true]);
    });

    it('uses detected directories without admin discovery and removes overlapping default roots', async () => {
        discovery.libraries = [];
        discovery.roots = [
            { libraryId: 'lib', path: '/photos', count: 1 },
            { libraryId: 'lib', path: '/photos/holiday', count: 2 },
            { libraryId: 'lib', path: '/photos-other', count: 3 },
            { libraryId: 'lib', path: '/photos', count: 1 }
        ];
        await connect();
        expect(folderChecks()).toHaveLength(2);
        await folderChecks()[0].setValue(false);
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(savedBody().selection.roots).toEqual([{ libraryId: 'lib', path: '/photos-other' }]);
    });

    it('includes accessible directories outside discovered libraries', async () => {
        discovery.roots.push({ libraryId: 'shared-lib', path: '/shared', count: 1 });
        await connect();
        expect(folderChecks()).toHaveLength(3);
        expect(folderChecks().every(isChecked)).toBe(true);
    });

    it('offers uploaded media when there are no folders or albums', async () => {
        discovery = { ...content(), suggestedMode: 'folders', libraries: [], roots: [], albums: [], uploadCount: 3 };
        await connect();
        expect(wrapper!.text()).toContain('Uploaded photos and videos selected');
        expect(button('Connect and sync').attributes('disabled')).toBeUndefined();
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(savedBody().selection.includeUnfiled).toBe(true);
    });

    it('keeps an empty server editable without offering an empty import', async () => {
        discovery = { ...content(), libraries: [], roots: [], albums: [], assetCount: 0, uploadCount: 0 };
        await connect();
        expect(button('Connect and sync').attributes('disabled')).toBeDefined();
        expect(button('Change').exists()).toBe(true);
    });

    it('retains saved selections and advanced settings when editing, including after key rotation', async () => {
        sources = [savedSource({ selection: { ...emptySelection(), mode: 'albums', albumIds: ['family'], exclusions: ['/photos/private'], intervalMinutes: 60 } })];
        wrapper = mount(SourceSettings);
        await flushPromises();
        await button('Edit').trigger('click');
        await flushPromises();
        expect(albumChecks().map(isChecked)).toEqual([false, true]);
        expect(request.mock.calls.find(([url]) => url === '/api/admin/sources/immich/test')![1]!.body).not.toContain('apiKey');
        await button('Update API key').trigger('click');
        await wrapper!.find('input[type="password"]').setValue('rotated-key');
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(albumChecks().map(isChecked)).toEqual([false, true]);
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(savedBody('PATCH')).toMatchObject({ apiKey: 'rotated-key', selection: { mode: 'albums', roots: [], albumIds: ['family'], exclusions: ['/photos/private'], intervalMinutes: 60 } });
        expect(request.mock.calls.some(([url]) => url === '/api/admin/sources/1/sync')).toBe(true);
    });

    it('preselects folders when switching an older album-only source into an unused mode', async () => {
        sources = [savedSource({ selection: { ...emptySelection(), mode: 'albums', albumIds: ['family'] } })];
        wrapper = mount(SourceSettings);
        await flushPromises();
        await button('Edit').trigger('click');
        await flushPromises();
        expect(albumChecks().map(isChecked)).toEqual([false, true]);
        await wrapper.find('input[value="folders"]').setValue(true);
        expect(folderChecks().map(isChecked)).toEqual([true, true]);
        expect(wrapper.text()).toContain('2 folders selected');
        await folderChecks()[0].setValue(false);
        await wrapper.find('input[value="albums"]').setValue(true);
        await wrapper.find('input[value="folders"]').setValue(true);
        expect(folderChecks().map(isChecked)).toEqual([false, true]);
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(savedBody('PATCH').selection).toMatchObject({ roots: [{ libraryId: 'lib', path: '/other' }], albumIds: ['family'], initializedModes: ['albums', 'folders'] });
    });

    it('preselects albums when enabling Both on an older folders-only source', async () => {
        sources = [savedSource({ selection: { ...emptySelection(), roots: [{ libraryId: 'lib', path: '/photos' }] } })];
        wrapper = mount(SourceSettings);
        await flushPromises();
        await button('Edit').trigger('click');
        await flushPromises();
        await wrapper.find('input[value="both"]').setValue(true);
        expect(folderChecks().map(isChecked)).toEqual([true, false]);
        expect(albumChecks().map(isChecked)).toEqual([true, true]);
    });

    it('preserves a deliberately empty category across saved edits and mode changes', async () => {
        sources = [savedSource({ selection: { ...emptySelection(), mode: 'albums', albumIds: ['family'], initializedModes: ['folders', 'albums'] } })];
        wrapper = mount(SourceSettings);
        await flushPromises();
        await button('Edit').trigger('click');
        await flushPromises();
        await wrapper.find('input[value="folders"]').setValue(true);
        expect(folderChecks().map(isChecked)).toEqual([false, false]);
        await wrapper.find('input[value="both"]').setValue(true);
        expect(folderChecks().map(isChecked)).toEqual([false, false]);
        expect(albumChecks().map(isChecked)).toEqual([false, true]);
    });

    it('explains duplicate local scanning and offers the actual folder-exclusion control', async () => {
        wrapper = mount(SourceSettings);
        await flushPromises();
        expect(wrapper.text()).toContain('Settings → General Settings → Excluded source folders');
        expect(wrapper.text()).toContain('then run a scan in Scan & Library');
        await button('Open folder exclusions').trigger('click');
        expect(wrapper.emitted('manage-local-exclusions')).toHaveLength(1);
    });

    it('keeps environment-managed configuration read-only', async () => {
        sources = [savedSource({ managed_by: 'environment' })];
        wrapper = mount(SourceSettings);
        await flushPromises();
        await button('View configuration').trigger('click');
        await flushPromises();
        expect(wrapper!.find('fieldset').attributes('disabled')).toBeDefined();
        expect(wrapper!.text()).toContain('Environment values take precedence');
        expect(button('Save and sync')).toBeUndefined();
    });

    it('keeps failed connections on the connection step and supports retry', async () => {
        await openConnection();
        request.mockRejectedValueOnce(new Error('Invalid or revoked Immich API key.'));
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(wrapper!.find('[role="alert"]').text()).toContain('Invalid or revoked');
        expect(button('Continue').exists()).toBe(true);
        await wrapper!.find('form').trigger('submit');
        await flushPromises();
        expect(folderChecks().every(isChecked)).toBe(true);
        expect(button('Connect and sync').exists()).toBe(true);
    });

    it('requires a concrete disable confirmation', async () => {
        sources = [savedSource({ status: 'error', last_error: 'Missing asset.read permission' })];
        wrapper = mount(SourceSettings);
        await flushPromises();
        expect(wrapper!.text()).toContain('Missing asset.read permission');
        await button('Disable').trigger('click');
        expect(wrapper!.find('[role="dialog"]').text()).toContain('content and shares become unavailable');
        expect(request.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    });
});
