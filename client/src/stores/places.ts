import { defineStore } from 'pinia';

import { fetchPlaceImages, fetchPlaces, fetchPlacesStatus, preparePlacesGeodata, rebuildPlaces } from '../api/gallery';
import { i18n } from '../locales';
import type { FeedItem, PlaceDetail, PlacesStatus } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

interface PlacesState {
  items: PlaceDetail[];
  loadingList: boolean;
  hasLoadedList: boolean;
  listError: string | null;
  currentPlace: PlaceDetail | null;
  currentImages: FeedItem[];
  currentPage: number;
  currentLimit: number;
  currentHasMore: boolean;
  loadingPlace: boolean;
  currentSlug: string | null;
  placeRequestId: number;
  placeError: string | null;
  status: PlacesStatus | null;
  statusError: string | null;
  preparing: boolean;
  rebuilding: boolean;
  actionMessage: string | null;
}

export const usePlacesStore = defineStore('places', {
  state: (): PlacesState => ({
    items: [],
    loadingList: false,
    hasLoadedList: false,
    listError: null,
    currentPlace: null,
    currentImages: [],
    currentPage: 1,
    currentLimit: 24,
    currentHasMore: true,
    loadingPlace: false,
    currentSlug: null,
    placeRequestId: 0,
    placeError: null,
    status: null,
    statusError: null,
    preparing: false,
    rebuilding: false,
    actionMessage: null
  }),
  actions: {
    async fetchPlaces(force = false) {
      if (this.loadingList || (!force && this.hasLoadedList)) {
        return;
      }

      this.loadingList = true;
      this.listError = null;

      try {
        const payload = await fetchPlaces();
        this.items = payload.items;
        this.hasLoadedList = true;
      } catch (error) {
        this.items = [];
        this.hasLoadedList = false;
        this.listError = error instanceof Error ? error.message : i18n.global.t('placesPage.errors.load');
      } finally {
        this.loadingList = false;
      }
    },

    async loadPlace(slug: string, reset = true) {
      const isSamePlace = this.currentSlug === slug;
      if (this.loadingPlace && (!reset || isSamePlace)) {
        return;
      }

      const shouldReset = reset || !isSamePlace;
      if (shouldReset) {
        this.currentPlace = null;
        this.currentImages = [];
        this.currentPage = 1;
        this.currentHasMore = true;
      }

      const requestId = this.placeRequestId + 1;
      const page = this.currentPage;
      this.currentSlug = slug;
      this.placeRequestId = requestId;
      this.loadingPlace = true;
      this.placeError = null;

      try {
        const payload = await fetchPlaceImages(slug, page, this.currentLimit);
        if (this.placeRequestId !== requestId || this.currentSlug !== slug) {
          return;
        }

        this.currentPlace = payload.place;
        this.currentImages.push(...payload.items);
        this.currentPage += 1;
        this.currentHasMore = payload.hasMore;
      } catch (error) {
        if (this.placeRequestId !== requestId || this.currentSlug !== slug) {
          return;
        }

        this.currentPlace = null;
        this.placeError = error instanceof Error ? error.message : i18n.global.t('placePage.errors.load');
      } finally {
        if (this.placeRequestId === requestId && this.currentSlug === slug) {
          this.loadingPlace = false;
        }
      }
    },

    async fetchStatus() {
      this.statusError = null;
      try {
        this.status = await fetchPlacesStatus();
      } catch (error) {
        this.statusError = error instanceof Error ? error.message : i18n.global.t('settings.places.section.loadStatusError');
      }
    },

    async prepareGeodata() {
      this.preparing = true;
      this.actionMessage = null;
      try {
        const payload = await preparePlacesGeodata();
        this.status = payload.status;
        this.actionMessage = i18n.global.t('settings.places.section.actions.ready');
      } catch (error) {
        this.actionMessage = error instanceof Error ? error.message : i18n.global.t('settings.places.section.actions.prepareError');
      } finally {
        this.preparing = false;
      }
    },

    async rebuildAssignments() {
      this.rebuilding = true;
      this.actionMessage = null;
      try {
        const result = await rebuildPlaces();
        this.actionMessage = i18n.global.t('settings.places.section.actions.rebuilt', {
          assigned: new Intl.NumberFormat(i18n.global.locale.value).format(result.assigned),
          processed: new Intl.NumberFormat(i18n.global.locale.value).format(result.processed)
        });
        await this.fetchPlaces(true);
      } catch (error) {
        this.actionMessage = error instanceof Error ? error.message : i18n.global.t('settings.places.section.actions.rebuildError');
      } finally {
        this.rebuilding = false;
      }
    },

    updateImageCaption(id: number, caption: string | null) {
      this.currentImages = updateCaptionInItems(this.currentImages, id, caption);
    },

    removeImage(id: number) {
      this.currentImages = this.currentImages.filter((item) => item.id !== id);
    }
  }
});
