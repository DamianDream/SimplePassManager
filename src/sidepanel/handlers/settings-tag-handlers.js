/**
 * SimplePass Manager - Settings Tag Management Event Handlers
 */

import { panelState } from '../panel-state.js';
import { state } from '../../core/state.js';
import { validateTagName, getItemTags } from '../../core/categories.js';
import { persistVaultChanges } from '../vault-operations.js';
import { showToast } from '../render-utils.js';
import { t } from '../../core/i18n.js';
import { getStoredConfig, saveStoredConfig } from '../../core/storage.js';

export function attachSettingsTagHandlers({ renderApp }) {
  // Inline Tag Rename
  document.querySelectorAll('[data-action="start-tag-rename"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      panelState.editingTagId = btn.dataset.cat;
      renderApp();
      setTimeout(() => {
        const inp = document.getElementById('sp-rename-tag-input');
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 30);
    });
  });

  const btnCancelTagRename = document.getElementById('sp-btn-cancel-tag-rename');
  if (btnCancelTagRename) {
    btnCancelTagRename.addEventListener('click', e => {
      e.stopPropagation();
      panelState.editingTagId = null;
      renderApp();
    });
  }

  async function handleSaveTagRename(oldName) {
    const inp = document.getElementById('sp-rename-tag-input');
    const errBox = document.getElementById('sp-rename-tag-err');
    if (!inp) return;
    const newName = inp.value.trim();

    if (!newName) {
      if (errBox) {
        errBox.innerText = t('settings.tag_name_empty');
        errBox.style.display = 'block';
      }
      return;
    }

    if (newName === oldName) {
      panelState.editingTagId = null;
      renderApp();
      return;
    }

    const validRes = validateTagName(newName);
    if (!validRes.valid) {
      if (errBox) {
        errBox.innerText = validRes.error;
        errBox.style.display = 'block';
      }
      return;
    }

    const exists = state.categories.some(
      c => c.toLowerCase() === newName.toLowerCase() && c.toLowerCase() !== oldName.toLowerCase()
    );
    if (exists) {
      if (errBox) {
        errBox.innerText = t('toasts.tag_exists');
        errBox.style.display = 'block';
      }
      return;
    }

    state.categories = state.categories.map(c => (c === oldName ? newName : c));

    if (state.categoryColors && state.categoryColors[oldName]) {
      const colorVal = state.categoryColors[oldName];
      delete state.categoryColors[oldName];
      state.categoryColors[newName] = colorVal;
    }

    state.items = state.items.map(it => {
      const itemTags = getItemTags(it);
      const updatedTags = [...new Set(itemTags.map(t => (t === oldName ? newName : t)))];
      const updatedCat = it.category === oldName ? newName : it.category;
      return { ...it, category: updatedCat, tags: updatedTags };
    });

    if (state.activeCategory === oldName) {
      state.activeCategory = newName;
    }

    await persistVaultChanges();
    const cfg = await getStoredConfig();
    await saveStoredConfig({
      ...cfg,
      categories: state.categories.filter(c => c !== 'All'),
      categoryColors: state.categoryColors
    });

    panelState.editingTagId = null;
    showToast(t('settings.cat_renamed'));
    renderApp();
  }

  const btnSaveTagRename = document.getElementById('sp-btn-save-tag-rename');
  if (btnSaveTagRename) {
    btnSaveTagRename.addEventListener('click', async e => {
      e.stopPropagation();
      const oldName = btnSaveTagRename.dataset.oldName || panelState.editingTagId;
      await handleSaveTagRename(oldName);
    });
  }

  const renameTagInput = document.getElementById('sp-rename-tag-input');
  if (renameTagInput) {
    renameTagInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await handleSaveTagRename(panelState.editingTagId);
      } else if (e.key === 'Escape') {
        panelState.editingTagId = null;
        renderApp();
      }
    });
  }

  // Add Tag
  const btnAddCat = document.getElementById('sp-btn-add-cat');
  const newCatInput = document.getElementById('sp-new-cat-name');
  const catErr = document.getElementById('sp-cat-err');
  if (btnAddCat && newCatInput) {
    const handleAddTag = async () => {
      const name = newCatInput.value.trim();
      if (!name) return;
      const validRes = validateTagName(name);
      if (!validRes.valid) {
        if (catErr) {
          catErr.innerText = validRes.error;
          catErr.style.display = 'block';
        }
        return;
      }
      if (state.categories.some(c => c.toLowerCase() === name.toLowerCase())) {
        if (catErr) {
          catErr.innerText = t('toasts.tag_exists');
          catErr.style.display = 'block';
        }
        return;
      }
      state.categories.push(name);
      if (!state.categoryColors) state.categoryColors = {};
      state.categoryColors[name] = panelState.selectedNewCatColor;
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All'),
        categoryColors: state.categoryColors
      });
      showToast(t('toasts.tag_added', { name }));
      renderApp();
    };

    btnAddCat.addEventListener('click', handleAddTag);
    newCatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    });
  }

  // Category Colors
  document.querySelectorAll('[data-action="select-new-cat-color"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      panelState.selectedNewCatColor = btn.dataset.colorId;
      renderApp();
    });
  });

  document.querySelectorAll('[data-action="toggle-cat-color-picker"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      panelState.activeColorPickerCat = panelState.activeColorPickerCat === cat ? null : cat;
      renderApp();
    });
  });

  document.querySelectorAll('[data-action="set-cat-color"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const colorId = btn.dataset.colorId;
      if (!state.categoryColors) state.categoryColors = {};
      state.categoryColors[cat] = colorId;
      panelState.activeColorPickerCat = null;
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categoryColors: state.categoryColors
      });
      showToast(t('settings.cat_color_updated'));
      renderApp();
    });
  });

  // Delete Tag
  document.querySelectorAll('.sp-cat-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const catToDelete = btn.dataset.cat;
      if (catToDelete === 'Work' || catToDelete === 'Personal') return;
      state.categories = state.categories.filter(c => c !== catToDelete);
      if (state.categoryColors) {
        delete state.categoryColors[catToDelete];
      }
      state.items = state.items.map(it => {
        const itemTags = getItemTags(it);
        const filtered = itemTags.filter(t => t !== catToDelete);
        const finalTags = filtered.length > 0 ? filtered : ['Work'];
        return {
          ...it,
          tags: finalTags,
          category: it.category === catToDelete ? finalTags[0] : it.category
        };
      });
      if (state.activeCategory === catToDelete) {
        state.activeCategory = 'All';
      }
      await persistVaultChanges();
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All'),
        categoryColors: state.categoryColors
      });
      showToast(t('toasts.tag_deleted', { name: catToDelete }));
      renderApp();
    });
  });
}
