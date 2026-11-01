<template>
  <div class="vm-file-storage">
    <label for="mcp-file-directory" v-text="i18n('labelMcpFileDirectory')" />
    <div class="vm-file-storage-controls">
      <input id="mcp-file-directory" v-model="draft" type="text" maxlength="512"
             :placeholder="defaultDirectory" :disabled="!loaded || saving"
             :aria-invalid="!!error" aria-describedby="mcp-file-directory-help"
             spellcheck="false" @input="message = ''" @keydown.enter.prevent="save()" />
      <button :disabled="!loaded || saving || !!error || draft === saved"
              v-text="i18n('buttonSave')" @click="save()" />
      <button :disabled="!loaded || saving || draft === defaultDirectory && saved === defaultDirectory"
              v-text="i18n('buttonReset')" @click="reset()" />
    </div>
    <p id="mcp-file-directory-help" v-text="i18n('labelMcpFileDirectoryHint')" />
    <p v-if="error" class="text-red" role="alert" v-text="error" />
    <p v-else class="vm-file-storage-preview" v-text="preview" />
    <p v-if="message" role="status" v-text="message" />
    <button v-text="i18n('buttonBrowserDownloadSettings')" @click="openDownloadSettings" />
    <p v-text="i18n('labelMcpFileDirectoryWatcher')" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { i18n, sendCmdDirectly } from '@/common';
import browser from '@/common/browser';
import { validateFileDirectory } from '@/common/file-path';
import hookSetting from '@/common/hook-setting';
import options from '@/common/options';
import defaults, { kMcpFileDirectory } from '@/common/options-defaults';

const defaultDirectory = defaults[kMcpFileDirectory];
const draft = ref(defaultDirectory);
const saved = ref(defaultDirectory);
const loaded = ref(false);
const saving = ref(false);
const message = ref('');
const error = computed(() => {
  try { validateFileDirectory(draft.value); return ''; }
  catch { return i18n('labelMcpFileDirectoryInvalid'); }
});
const preview = computed(() => i18n('labelMcpFileDirectoryPreview', [
  [i18n('labelBrowserDownloadDirectory'), draft.value, 'mail', 'email.eml'].filter(Boolean).join('/'),
]));
const revoke = hookSetting(kMcpFileDirectory, value => {
  if (!loaded.value || draft.value === saved.value) draft.value = value;
  saved.value = value;
  loaded.value = true;
});
onBeforeUnmount(revoke);

async function save() {
  if (!loaded.value || saving.value || error.value || draft.value === saved.value) return;
  const value = draft.value;
  saving.value = true;
  message.value = '';
  try {
    await sendCmdDirectly('SetOptions', { [kMcpFileDirectory]: value });
    options.update({ [kMcpFileDirectory]: value });
    saved.value = value;
    message.value = i18n('buttonSaved');
  } catch { message.value = i18n('labelMcpFileDirectorySaveError'); }
  finally { saving.value = false; }
}
function reset() {
  draft.value = defaultDirectory;
  return save();
}
function openDownloadSettings() {
  return browser.tabs.create({ url: IS_FIREFOX ? 'about:preferences#general' : 'chrome://settings/downloads' });
}
</script>

<style>
.vm-file-storage {
  width: 100%;
  margin: .5em 0;
  & > label {
    font-weight: 500;
  }
  & > p {
    margin: .4em 0;
    font-size: .85em;
    color: var(--fill-9);
  }
}
.vm-file-storage-controls {
  display: flex;
  flex-wrap: wrap;
  gap: .4em;
  margin-top: .4em;
  & > input {
    flex: 1 1 18em;
    min-width: 0;
    padding: .3em .5em;
  }
}
.vm-file-storage-preview {
  overflow-wrap: anywhere;
}
</style>
