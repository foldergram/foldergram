<template>
  <section
    class="pattern-gate"
    role="dialog"
    aria-modal="true"
    :aria-label="t('auth.patternGate.padLabel')"
  >
    <div class="pattern-gate__stage" :class="{ 'pattern-gate--shake': shaking }">
      <PatternPad
        :show-error="showError"
        :disabled="authStore.loading"
        :aria-label="t('auth.patternGate.padLabel')"
        @complete="onPatternComplete"
      />
    </div>

    <p v-if="visibleError" class="pattern-gate__error">{{ visibleError }}</p>

    <template v-if="canResetWithPassword">
      <form v-if="showPasswordRecovery" class="pattern-gate__recovery" @submit.prevent="submitPasswordRecovery">
        <label class="pattern-gate__recovery-label">
          <span>{{ t('auth.patternGate.adminPasswordLabel') }}</span>
          <input
            v-model="recoveryPassword"
            type="password"
            autocomplete="current-password"
            :disabled="authStore.loading"
          />
        </label>
        <div class="pattern-gate__recovery-actions">
          <button type="button" :disabled="authStore.loading" @click="showPasswordRecovery = false">
            {{ t('auth.patternGate.backToPattern') }}
          </button>
          <button type="submit" :disabled="authStore.loading || recoveryPassword.length === 0">
            {{ t('auth.patternGate.resetAndSignIn') }}
          </button>
        </div>
      </form>
      <button
        v-else
        class="pattern-gate__forgot"
        type="button"
        @click="showPasswordRecovery = true; patternError = null; authStore.clearError();"
      >
        {{ t('auth.patternGate.forgotPattern') }}
      </button>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import PatternPad from './PatternPad.vue';
import { useAuthStore } from '../stores/auth';

const WRONG_ATTEMPTS_BEFORE_RESET = 5;

const { t } = useI18n();
const authStore = useAuthStore();
const patternError = ref<string | null>(null);
const showError = ref(false);
const shaking = ref(false);
const showPasswordRecovery = ref(false);
const recoveryPassword = ref('');
const wrongAttempts = ref(0);
let shakeTimer: number | null = null;

const visibleError = computed(() => patternError.value ?? authStore.error);
const canResetWithPassword = computed(() => wrongAttempts.value >= WRONG_ATTEMPTS_BEFORE_RESET);

function flagWrongPattern() {
  showError.value = true;
  shaking.value = true;
  if (shakeTimer !== null) {
    window.clearTimeout(shakeTimer);
  }
  shakeTimer = window.setTimeout(() => {
    showError.value = false;
    shaking.value = false;
  }, 620);
}

async function onPatternComplete(pattern: string) {
  patternError.value = null;
  authStore.clearError();

  try {
    await authStore.unlockPattern(pattern);
    wrongAttempts.value = 0;
  } catch {
    wrongAttempts.value += 1;
    patternError.value = t('auth.patternGate.wrongPattern');
    flagWrongPattern();
  }
}

async function submitPasswordRecovery() {
  if (recoveryPassword.value.length === 0 || authStore.loading) {
    return;
  }

  patternError.value = null;
  authStore.clearError();

  try {
    await authStore.resetPatternWithPassword(recoveryPassword.value);
    recoveryPassword.value = '';
    showPasswordRecovery.value = false;
    wrongAttempts.value = 0;
  } catch {
    patternError.value = t('auth.patternGate.wrongAdminPassword');
  }
}
</script>

<style scoped>
.pattern-gate {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1.25rem;
  padding: 1.5rem;
  background: var(--bg);
}

.pattern-gate__stage {
  display: grid;
  place-items: center;
}

.pattern-gate__error {
  margin: 0;
  max-width: 18rem;
  text-align: center;
  font-size: 0.88rem;
  color: #c0392b;
}

.pattern-gate__forgot,
.pattern-gate__recovery-actions button {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--accent-strong);
}

.pattern-gate__recovery {
  display: grid;
  gap: 0.85rem;
  width: min(18rem, 86vw);
}

.pattern-gate__recovery-label {
  display: grid;
  gap: 0.45rem;
  text-align: left;
}

.pattern-gate__recovery-label span {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.pattern-gate__recovery-label input {
  height: 3rem;
  border: 1px solid var(--border);
  border-radius: 0.95rem;
  background: color-mix(in srgb, var(--surface-alt) 84%, transparent 16%);
  padding: 0 1rem;
  color: var(--text);
  outline: none;
}

.pattern-gate__recovery-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.pattern-gate--shake :deep(.pattern-pad) {
  animation: pattern-gate-shake 0.6s ease;
}

@keyframes pattern-gate-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-0.55rem); }
  40% { transform: translateX(0.55rem); }
  60% { transform: translateX(-0.35rem); }
  80% { transform: translateX(0.35rem); }
}
</style>
