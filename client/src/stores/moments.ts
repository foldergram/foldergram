import { defineStore } from 'pinia';

import { fetchMomentFeed, fetchMoments } from '../api/gallery';
import { i18n } from '../locales';
import type { CalendarDateParts, FeedItem, FeedRailKind, MomentCapsule } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

interface MomentsState {
  railKind: FeedRailKind;
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  items: MomentCapsule[];
  loadingList: boolean;
  listError: string | null;
  currentMoment: MomentCapsule | null;
  currentImages: FeedItem[];
  currentPage: number;
  currentLimit: number;
  currentHasMore: boolean;
  loadingMoment: boolean;
  momentError: string | null;
}

function parseLeadingCount(value: string): number | null {
  const match = value.match(/^(\d+)/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function localizeRailLabels(kind: FeedRailKind) {
  void i18n.global.locale.value;

  if (kind === 'highlights') {
    return {
      title: i18n.global.t('moments.rails.highlights.title'),
      description: i18n.global.t('moments.rails.highlights.description'),
      singularLabel: i18n.global.t('moments.rails.highlights.singularLabel')
    };
  }

  return {
    title: i18n.global.t('moments.rails.moments.title'),
    description: i18n.global.t('moments.rails.moments.description'),
    singularLabel: i18n.global.t('moments.rails.moments.singularLabel')
  };
}

function getCurrentLocale() {
  return i18n.global.locale.value;
}

function createDateFromParts(date: CalendarDateParts): Date | null {
  if (
    !Number.isInteger(date.year)
    || !Number.isInteger(date.month)
    || !Number.isInteger(date.day)
    || date.month < 1
    || date.month > 12
    || date.day < 1
    || date.day > 31
  ) {
    return null;
  }

  const parsedDate = new Date(date.year, date.month - 1, date.day);
  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getFullYear() !== date.year
    || parsedDate.getMonth() !== date.month - 1
    || parsedDate.getDate() !== date.day
  ) {
    return null;
  }

  return parsedDate;
}

function formatLocalizedMonthDay(date: CalendarDateParts): string | null {
  const localizedDate = createDateFromParts(date);
  if (!localizedDate) {
    return null;
  }

  return new Intl.DateTimeFormat(getCurrentLocale(), {
    month: 'long',
    day: 'numeric'
  }).format(localizedDate);
}

function formatLocalizedMonthYear(date: CalendarDateParts): string | null {
  const localizedDate = createDateFromParts(date);
  if (!localizedDate) {
    return null;
  }

  return new Intl.DateTimeFormat(getCurrentLocale(), {
    month: 'long',
    year: 'numeric'
  }).format(localizedDate);
}

function formatLocalizedDateRange(startDate: CalendarDateParts, endDate: CalendarDateParts): string | null {
  const localizedStartDate = createDateFromParts(startDate);
  const localizedEndDate = createDateFromParts(endDate);
  if (!localizedStartDate || !localizedEndDate) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat(getCurrentLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  if (typeof formatter.formatRange === 'function') {
    return formatter.formatRange(localizedStartDate, localizedEndDate);
  }

  return `${formatter.format(localizedStartDate)} - ${formatter.format(localizedEndDate)}`;
}

function localizeCapsule(capsule: MomentCapsule, railKind: FeedRailKind): MomentCapsule {
  void i18n.global.locale.value;

  switch (capsule.id) {
    case 'on-this-day': {
      if (capsule.momentDate?.type !== 'on-this-day') {
        return capsule;
      }

      const date = formatLocalizedMonthDay(capsule.momentDate.date);
      if (!date) {
        return capsule;
      }

      return {
        ...capsule,
        title: i18n.global.t('moments.capsules.onThisDay.title'),
        subtitle: i18n.global.t('moments.capsules.onThisDay.subtitle', { date }),
        dateContext: date
      };
    }
    case 'this-week-previous-years': {
      if (capsule.momentDate?.type !== 'this-week-previous-years') {
        return capsule;
      }

      const { startDate, endDate } = capsule.momentDate;
      const range = formatLocalizedDateRange(startDate, endDate);
      if (!range) {
        return capsule;
      }

      return {
        ...capsule,
        title: i18n.global.t('moments.capsules.thisWeekPreviousYears.title'),
        subtitle: i18n.global.t('moments.capsules.thisWeekPreviousYears.subtitle', { range }),
        dateContext: range
      };
    }
    case 'from-last-year': {
      if (capsule.momentDate?.type !== 'from-last-year') {
        return capsule;
      }

      const { referenceDate, startDate, endDate } = capsule.momentDate;
      const monthYear = formatLocalizedMonthYear(referenceDate);
      const range = formatLocalizedDateRange(startDate, endDate);
      if (!monthYear || !range) {
        return capsule;
      }

      return {
        ...capsule,
        title: i18n.global.t('moments.capsules.fromLastYear.title'),
        subtitle: i18n.global.t('moments.capsules.fromLastYear.subtitle', {
          monthYear
        }),
        dateContext: range
      };
    }
    case 'highlight-recent-batches': {
      const count = parseLeadingCount(capsule.dateContext) ?? 0;

      return {
        ...capsule,
        title: i18n.global.t('moments.capsules.highlightRecentBatches.title'),
        subtitle: i18n.global.t('moments.capsules.highlightRecentBatches.subtitle'),
        dateContext:
          count === 1
            ? i18n.global.t('moments.capsules.highlightRecentBatches.dateContextOne', { count })
            : i18n.global.t('moments.capsules.highlightRecentBatches.dateContextOther', { count })
      };
    }
    case 'highlight-forgotten-favorites':
      return {
        ...capsule,
        title: i18n.global.t('moments.capsules.highlightForgottenFavorites.title'),
        subtitle: i18n.global.t('moments.capsules.highlightForgottenFavorites.subtitle'),
        dateContext: i18n.global.t('moments.capsules.highlightForgottenFavorites.dateContext')
      };
    case 'highlight-deep-cuts':
      return {
        ...capsule,
        title: i18n.global.t('moments.capsules.highlightDeepCuts.title'),
        subtitle: i18n.global.t('moments.capsules.highlightDeepCuts.subtitle'),
        dateContext: i18n.global.t('moments.capsules.highlightDeepCuts.dateContext')
      };
    case 'highlight-lucky-dip':
      return {
        ...capsule,
        title: i18n.global.t('moments.capsules.highlightLuckyDip.title'),
        subtitle: i18n.global.t('moments.capsules.highlightLuckyDip.subtitle'),
        dateContext: i18n.global.t('moments.capsules.highlightLuckyDip.dateContext')
      };
    default:
      return railKind === 'highlights' ? capsule : capsule;
  }
}

export const useMomentsStore = defineStore('moments', {
  state: (): MomentsState => ({
    railKind: 'moments',
    railTitle: 'Moments',
    railDescription: 'Memory capsules from your library.',
    railSingularLabel: 'Moment',
    items: [],
    loadingList: false,
    listError: null,
    currentMoment: null,
    currentImages: [],
    currentPage: 1,
    currentLimit: 18,
    currentHasMore: true,
    loadingMoment: false,
    momentError: null
  }),
  getters: {
    displayRailTitle: (state) => localizeRailLabels(state.railKind).title,
    displayRailDescription: (state) => localizeRailLabels(state.railKind).description,
    displayRailSingularLabel: (state) => localizeRailLabels(state.railKind).singularLabel,
    localizedItems: (state) => state.items.map((item) => localizeCapsule(item, state.railKind)),
    currentCapsule: (state) => (state.currentMoment ? localizeCapsule(state.currentMoment, state.railKind) : null),
    currentError: (state) => state.momentError
  },
  actions: {
    removeImage(imageId: number) {
      if (this.currentMoment) {
        const existedInMoment = this.currentImages.some((item) => item.id === imageId);
        this.currentImages = this.currentImages.filter((item) => item.id !== imageId);

        if (existedInMoment) {
          const nextCount = Math.max(0, this.currentMoment.imageCount - 1);
          this.currentMoment = nextCount > 0 ? { ...this.currentMoment, imageCount: nextCount } : null;
          this.currentHasMore = nextCount > this.currentImages.length;
        }
      }
    },

    resetForRebuild() {
      this.railKind = 'moments';
      this.railTitle = 'Moments';
      this.railDescription = 'Memory capsules from your library.';
      this.railSingularLabel = 'Moment';
      this.items = [];
      this.loadingList = false;
      this.listError = null;
      this.currentMoment = null;
      this.currentImages = [];
      this.currentPage = 1;
      this.currentHasMore = true;
      this.loadingMoment = false;
      this.momentError = null;
    },

    async fetchMoments(force = false) {
      if (this.loadingList) {
        return;
      }

      if (!force && this.items.length > 0) {
        return;
      }

      this.loadingList = true;
      this.listError = null;

      try {
        const payload = await fetchMoments();
        this.railKind = payload.railKind;
        this.railTitle = payload.railTitle;
        this.railDescription = payload.railDescription;
        this.railSingularLabel = payload.railSingularLabel;
        this.items = payload.items;
      } catch (error) {
        this.listError = error instanceof Error ? error.message : i18n.global.t('errors.loadHomeRail');
      } finally {
        this.loadingList = false;
      }
    },

    async loadMoment(id: string, reset = true) {
      if (this.loadingMoment) {
        return;
      }

      if (reset) {
        this.currentMoment = null;
        this.currentImages = [];
        this.currentPage = 1;
        this.currentHasMore = true;
      }

      this.loadingMoment = true;
      this.momentError = null;

      try {
        const payload = await fetchMomentFeed(id, this.currentPage, this.currentLimit);
        this.railKind = payload.railKind;
        this.railTitle = payload.railTitle;
        this.railDescription = payload.railDescription;
        this.railSingularLabel = payload.railSingularLabel;
        this.currentMoment = payload.moment;
        this.currentImages.push(...payload.items);
        this.currentPage += 1;
        this.currentHasMore = payload.hasMore;
      } catch (error) {
        this.currentMoment = null;
        this.momentError = error instanceof Error ? error.message : i18n.global.t('errors.loadFeedCapsule');
      } finally {
        this.loadingMoment = false;
      }
    },

    async loadCapsule(id: string, reset = true) {
      await this.loadMoment(id, reset);
    },

    updateImageCaption(id: number, caption: string | null) {
      this.currentImages = updateCaptionInItems(this.currentImages, id, caption);
    }
  }
});
