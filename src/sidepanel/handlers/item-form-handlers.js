/**
 * SimplePass Manager - Item Form Event Handlers (Add / Edit Password)
 */

import { state, updateState, getActiveProject, copyToClipboard } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { generatePassword } from '../../core/generator.js';
import { extractCleanDomain, extractDomainName } from '../../core/domain.js';
import { validateTagName, getCategoryColorDef, getCategoryCssVars } from '../../core/categories.js';
import { getStoredConfig, saveStoredConfig } from '../../core/storage.js';
import { resolveFavicon, getCachedFavicon } from '../../core/favicon.js';
import { panelState, saveFormDraftFromDOM, clearFormDraft } from '../panel-state.js';
import { showToast, escapeHtml } from '../render-utils.js';
import { saveItem, deleteItem, downloadItemAsCsv, persistVaultChanges, parseCsvFile } from '../vault-operations.js';
import { renderFormTagsSelectedHtml } from '../views/item-form.js';

export function attachItemFormHandlers({ renderApp }) {
  // 1. Back button & Delete button
  const btnBack = document.getElementById('sp-form-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      clearFormDraft();
      updateState({ activeTab: 'vault', selectedItem: null });
      renderApp();
    });
  }

  const btnFormExportCsv = document.getElementById('sp-form-export-csv');
  if (btnFormExportCsv && state.selectedItem) {
    btnFormExportCsv.addEventListener('click', () => {
      downloadItemAsCsv(state.selectedItem, { renderApp });
    });
  }

  const btnDelete = document.getElementById('sp-form-delete');
  if (btnDelete && state.selectedItem) {
    btnDelete.addEventListener('click', () => {
      const id = state.selectedItem.id;
      clearFormDraft();
      deleteItem(id, { renderApp });
    });
  }

  // 2. Password visibility toggle & Inline generator
  const btnToggleVis = document.getElementById('sp-toggle-pwd-vis');
  if (btnToggleVis) {
    btnToggleVis.addEventListener('click', () => {
      panelState.isPasswordVisible = !panelState.isPasswordVisible;
      const pwdInput = document.getElementById('sp-item-password');
      if (pwdInput) pwdInput.type = panelState.isPasswordVisible ? 'text' : 'password';
      btnToggleVis.innerHTML = panelState.isPasswordVisible ? icons.iEyeOff : icons.iEye;
    });
  }

  const btnGenInline = document.getElementById('sp-btn-gen-inline');
  if (btnGenInline) {
    btnGenInline.addEventListener('click', () => {
      const newPwd = generatePassword({ length: 22 });
      const pwdInput = document.getElementById('sp-item-password');
      if (pwdInput) {
        pwdInput.value = newPwd;
        pwdInput.type = 'text';
        panelState.isPasswordVisible = true;
        pwdInput.classList.remove('has-error');
        const pwdErr = document.getElementById('sp-item-password-error');
        if (pwdErr) pwdErr.style.display = 'none';
      }
      saveFormDraftFromDOM();
    });
  }

  // Password history toggle and actions
  const toggleHistoryBtn = document.getElementById('sp-toggle-pwd-history');
  const historyList = document.getElementById('sp-pwd-history-list');
  if (toggleHistoryBtn && historyList) {
    toggleHistoryBtn.addEventListener('click', e => {
      e.preventDefault();
      const isVisible = historyList.style.display === 'flex';
      historyList.style.display = isVisible ? 'none' : 'flex';
    });
  }

  document.querySelectorAll('[data-action="copy-history-pwd"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const pwd = btn.dataset.pwd;
      if (pwd) {
        await copyToClipboard(pwd);
        showToast(t('form.pwd_history_copied'));
      }
    });
  });

  document.querySelectorAll('[data-action="restore-history-pwd"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const pwd = btn.dataset.pwd;
      const pwdInput = document.getElementById('sp-item-password');
      if (pwd && pwdInput) {
        pwdInput.value = pwd;
        pwdInput.type = 'text';
        panelState.isPasswordVisible = true;
        showToast(t('form.pwd_history_restored'));
        saveFormDraftFromDOM();
      }
    });
  });

  // 3. URL Input & Favicon auto-resolution
  const urlInput = document.getElementById('sp-item-url');
  if (urlInput) {
    urlInput.addEventListener('input', () => {
      const url = urlInput.value.trim();
      const domain = extractCleanDomain(url);
      const displayDomain = extractDomainName(url);
      const domainBadge = document.getElementById('sp-form-domain-badge');
      if (domainBadge) {
        if (displayDomain) {
          domainBadge.textContent = displayDomain;
          domainBadge.style.display = 'inline';
        } else {
          domainBadge.style.display = 'none';
        }
      }
      if (state.showFavicons && domain && panelState.cachedFavicons[domain]) {
        const preview = document.getElementById('sp-form-favicon-preview');
        if (preview) {
          preview.src = panelState.cachedFavicons[domain];
          preview.style.display = 'inline-block';
        }
        if (panelState.formDraft) {
          panelState.formDraft.domain = displayDomain;
          panelState.formDraft.favicon = panelState.cachedFavicons[domain];
        }
      }
    });

    urlInput.addEventListener('blur', async () => {
      if (!state.showFavicons) return;
      const url = urlInput.value.trim();
      const domain = extractCleanDomain(url);
      if (!domain) return;
      const hostNoPort = domain.split(':')[0];

      let fav =
        panelState.cachedFavicons[domain] ||
        panelState.cachedFavicons[hostNoPort] ||
        (await getCachedFavicon(domain)) ||
        (await getCachedFavicon(hostNoPort));

      if (!fav) {
        let currentTabFavicon = panelState.activeTabFavicon;
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
          try {
            const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
            if (tabs && tabs[0] && tabs[0].favIconUrl) {
              const tabHost = extractCleanDomain(tabs[0].url);
              if (tabHost === domain || tabHost.split(':')[0] === hostNoPort) {
                currentTabFavicon = tabs[0].favIconUrl;
              }
            }
          } catch (_) {}
        }
        const res = await resolveFavicon(url, { forceRefresh: false, activeTabFavIconUrl: currentTabFavicon, useExternalServices: state.useExternalIcons === true });
        if (res && res.favicon) {
          fav = res.favicon;
          panelState.cachedFavicons[domain] = fav;
          if (hostNoPort) panelState.cachedFavicons[hostNoPort] = fav;
        }
      }
      if (fav) {
        if (panelState.formDraft) {
          panelState.formDraft.domain = domain;
          panelState.formDraft.favicon = fav;
        }
        const preview = document.getElementById('sp-form-favicon-preview');
        if (preview) {
          preview.src = fav;
          preview.style.display = 'inline-block';
        }
      }
    });
  }

  // 4. Refresh favicon button
  const refreshFaviconBtn = document.getElementById('sp-btn-refresh-favicon');
  if (refreshFaviconBtn) {
    refreshFaviconBtn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      const currentUrlInput = document.getElementById('sp-item-url');
      const url = currentUrlInput ? currentUrlInput.value.trim() : '';
      const domain = extractCleanDomain(url);
      if (!domain) {
        showToast(t('toasts.favicon_empty_url'));
        return;
      }

      refreshFaviconBtn.classList.add('sp-spin');
      refreshFaviconBtn.disabled = true;

      try {
        let currentTabFavicon = panelState.activeTabFavicon;
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
          try {
            const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
            if (tabs && tabs[0] && tabs[0].favIconUrl) {
              currentTabFavicon = tabs[0].favIconUrl;
            }
          } catch (_) {}
        }

        const res = await resolveFavicon(url, { forceRefresh: true, activeTabFavIconUrl: currentTabFavicon, useExternalServices: state.useExternalIcons === true });
        if (res && res.favicon) {
          const hostNoPort = domain.split(':')[0];
          panelState.cachedFavicons[domain] = res.favicon;
          if (res.domain) panelState.cachedFavicons[res.domain] = res.favicon;
          if (hostNoPort) panelState.cachedFavicons[hostNoPort] = res.favicon;

          const displayDomain = hostNoPort || domain;
          if (panelState.formDraft) {
            panelState.formDraft.domain = displayDomain;
            panelState.formDraft.favicon = res.favicon;
          }

          const domainBadge = document.getElementById('sp-form-domain-badge');
          if (domainBadge) {
            domainBadge.textContent = displayDomain;
            domainBadge.style.display = 'inline';
          }
          const preview = document.getElementById('sp-form-favicon-preview');
          if (preview) {
            preview.src = res.favicon;
            preview.style.display = 'inline-block';
          }

          const itemId = document.getElementById('sp-item-id')?.value;
          if (itemId) {
            const itemIdx = state.items.findIndex(i => i.id === itemId);
            if (itemIdx >= 0) {
              state.items[itemIdx].domain = displayDomain;
              state.items[itemIdx].favicon = res.favicon;
              await persistVaultChanges();
            }
          }

          showToast(t('toasts.favicon_updated'));
        } else {
          showToast(t('toasts.favicon_fetch_failed'));
        }
      } catch (_) {
        showToast(t('toasts.favicon_fetch_failed'));
      } finally {
        refreshFaviconBtn.classList.remove('sp-spin');
        refreshFaviconBtn.disabled = false;
      }
    });
  }

  // 5. Custom project dropdown in item form
  const projectSelectWrap = document.getElementById('sp-project-select-wrap');
  const projectSelectTrigger = document.getElementById('sp-project-select-trigger');
  const projectDropdown = document.getElementById('sp-project-dropdown');
  const projectHiddenInput = document.getElementById('sp-item-project');
  const projectSelectLabel = document.getElementById('sp-project-select-label');

  if (projectSelectWrap && projectSelectTrigger && projectDropdown) {
    const toggleProjectDropdown = e => {
      e?.stopPropagation();
      const isOpen = projectDropdown.style.display === 'flex' || projectSelectWrap.classList.contains('open');
      if (isOpen) {
        projectDropdown.style.display = 'none';
        projectSelectWrap.classList.remove('open');
      } else {
        projectDropdown.style.display = 'flex';
        projectSelectWrap.classList.add('open');
        const tagDrop = document.getElementById('sp-tags-dropdown');
        if (tagDrop) {
          tagDrop.style.display = 'none';
          document.querySelector('.sp-tag-input-container')?.classList.remove('open');
        }
      }
    };

    projectSelectTrigger.addEventListener('click', toggleProjectDropdown);

    projectDropdown.querySelectorAll('[data-action="select-form-project"]').forEach(optEl => {
      optEl.addEventListener('click', e => {
        e.stopPropagation();
        const pId = optEl.dataset.projectId;
        const pName = optEl.dataset.projectName;
        if (projectHiddenInput) projectHiddenInput.value = pId;
        if (projectSelectLabel) projectSelectLabel.textContent = pName;

        projectDropdown.querySelectorAll('[data-action="select-form-project"]').forEach(el => {
          const isCurrent = el.dataset.projectId === pId;
          el.classList.toggle('selected', isCurrent);
        });

        projectDropdown.style.display = 'none';
        projectSelectWrap.classList.remove('open');
        saveFormDraftFromDOM();
      });
    });
  }

  // 6. Multi-Tag selector
  const tagsContainer = document.getElementById('sp-form-tags-selected');
  if (tagsContainer) {
    tagsContainer.addEventListener('click', e => {
      const removeBtn = e.target.closest('[data-action="remove-form-tag"]');
      if (!removeBtn) return;
      e.stopPropagation();
      saveFormDraftFromDOM();
      const tagToRemove = removeBtn.dataset.tag;
      panelState.formSelectedTags = panelState.formSelectedTags.filter(t => t !== tagToRemove);
      if (panelState.formDraft) {
        panelState.formDraft.tags = [...panelState.formSelectedTags];
      }
      tagsContainer.innerHTML = renderFormTagsSelectedHtml();
    });
  }

  const tagSearchInput = document.getElementById('sp-tag-search-input');
  const tagDropdownToggle = document.getElementById('sp-tag-dropdown-toggle');
  const tagDropdown = document.getElementById('sp-tags-dropdown');
  const tagInputErr = document.getElementById('sp-tag-input-err');

  async function createAndSelectTag(newTagRaw) {
    const newTag = (newTagRaw || '').trim();
    if (!newTag) return;
    const validRes = validateTagName(newTag);
    if (!validRes.valid) {
      if (tagInputErr) {
        tagInputErr.innerText = validRes.error;
        tagInputErr.style.display = 'block';
      }
      return;
    }

    if (!state.categories.includes(newTag)) {
      state.categories.push(newTag);
      if (!state.categoryColors) state.categoryColors = {};
      state.categoryColors[newTag] = 'slate';
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All'),
        categoryColors: state.categoryColors
      });
    }
    if (!panelState.formSelectedTags.includes(newTag)) {
      panelState.formSelectedTags.push(newTag);
    }
    if (panelState.formDraft) {
      panelState.formDraft.tags = [...panelState.formSelectedTags];
    }
    if (tagSearchInput) tagSearchInput.value = '';
    if (tagDropdown) tagDropdown.style.display = 'none';
    const tagWrap = document.querySelector('.sp-tag-input-container');
    if (tagWrap) tagWrap.classList.remove('open');
    if (tagInputErr) tagInputErr.style.display = 'none';
    if (tagsContainer) tagsContainer.innerHTML = renderFormTagsSelectedHtml();
  }

  function updateTagDropdown(filterText = '') {
    if (!tagDropdown) return;
    const query = filterText.trim().toLowerCase();
    const allTags = state.categories.filter(c => c !== 'All');
    const matchedTags = allTags.filter(t => !query || t.toLowerCase().includes(query));

    let html = '';
    const trimmed = filterText.trim();
    const exactExists = allTags.some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (trimmed && !exactExists) {
      html += `
        <div class="sp-tag-drop-create sp-tag-drop-create-top" data-action="create-dropdown-tag" data-tag="${escapeHtml(trimmed)}">
          <span class="sp-tag-create-icon">${icons.iPlus}</span>
          <span class="sp-tag-create-text">${t('form.tags_create_option', { name: escapeHtml(trimmed) })}</span>
        </div>
      `;
    } else if (!trimmed) {
      html += `
        <div class="sp-tag-drop-create sp-tag-drop-create-top" data-action="prompt-create-tag">
          <span class="sp-tag-create-icon">${icons.iPlus}</span>
          <span class="sp-tag-create-text">${t('form.tags_create_new_action')}</span>
        </div>
      `;
    }

    if (matchedTags.length > 0) {
      html += matchedTags.map(tName => {
        const isSelected = panelState.formSelectedTags.includes(tName);
        const colorDef = getCategoryColorDef(tName, state.categoryColors);
        const cssVars = getCategoryCssVars(colorDef);
        const label = tName === 'Work' ? t('categories.Work') : (tName === 'Personal' ? t('categories.Personal') : tName);
        return `
          <div class="sp-tag-drop-item ${isSelected ? 'selected' : ''}" data-action="select-dropdown-tag" data-tag="${escapeHtml(tName)}">
            <span class="sp-pill sp-pill-tag-card" data-color-pill="true" style="${cssVars}; pointer-events:none;">
              <span class="sp-pill-dot" style="background-color:${colorDef.color};"></span>
              <span>${escapeHtml(label)}</span>
            </span>
            ${isSelected ? `<span style="color:var(--text-main); font-size:12px;">${icons.iCheck}</span>` : ''}
          </div>
        `;
      }).join('');
    }

    if (!html) {
      html = `<div style="padding:8px 10px; font-size:11px; color:var(--text-dim);">${t('form.tags_no_tags')}</div>`;
    }

    tagDropdown.innerHTML = html;
    tagDropdown.style.display = 'block';
    const tagWrap = document.querySelector('.sp-tag-input-container');
    if (tagWrap) tagWrap.classList.add('open');
    if (projectDropdown) {
      projectDropdown.style.display = 'none';
      projectSelectWrap?.classList.remove('open');
    }

    tagDropdown.querySelectorAll('[data-action="select-dropdown-tag"]').forEach(itemEl => {
      itemEl.addEventListener('click', e => {
        e.stopPropagation();
        saveFormDraftFromDOM();
        const selTag = itemEl.dataset.tag;
        if (!panelState.formSelectedTags.includes(selTag)) {
          panelState.formSelectedTags.push(selTag);
        } else {
          panelState.formSelectedTags = panelState.formSelectedTags.filter(t => t !== selTag);
        }
        if (panelState.formDraft) {
          panelState.formDraft.tags = [...panelState.formSelectedTags];
        }
        tagDropdown.style.display = 'none';
        tagWrap?.classList.remove('open');
        if (tagInputErr) tagInputErr.style.display = 'none';
        if (tagsContainer) tagsContainer.innerHTML = renderFormTagsSelectedHtml();
      });
    });

    tagDropdown.querySelectorAll('[data-action="prompt-create-tag"]').forEach(promptEl => {
      promptEl.addEventListener('click', async e => {
        e.stopPropagation();
        const inputName = window.prompt(t('form.tags_prompt_new'));
        if (inputName && inputName.trim()) {
          saveFormDraftFromDOM();
          await createAndSelectTag(inputName.trim());
        } else {
          tagSearchInput?.focus();
        }
      });
    });

    tagDropdown.querySelectorAll('[data-action="create-dropdown-tag"]').forEach(createEl => {
      createEl.addEventListener('click', async e => {
        e.stopPropagation();
        saveFormDraftFromDOM();
        await createAndSelectTag(createEl.dataset.tag);
      });
    });
  }

  if (tagSearchInput) {
    tagSearchInput.addEventListener('input', e => {
      if (tagInputErr) tagInputErr.style.display = 'none';
      updateTagDropdown(e.target.value);
    });

    tagSearchInput.addEventListener('focus', () => {
      updateTagDropdown(tagSearchInput.value);
    });

    tagSearchInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = tagSearchInput.value.trim();
        if (!val) return;
        saveFormDraftFromDOM();
        const allTags = state.categories.filter(c => c !== 'All');
        const matched = allTags.find(t => t.toLowerCase() === val.toLowerCase());
        if (matched) {
          if (!panelState.formSelectedTags.includes(matched)) {
            panelState.formSelectedTags.push(matched);
          }
          if (panelState.formDraft) {
            panelState.formDraft.tags = [...panelState.formSelectedTags];
          }
          tagSearchInput.value = '';
          tagDropdown.style.display = 'none';
          document.querySelector('.sp-tag-input-container')?.classList.remove('open');
          if (tagsContainer) tagsContainer.innerHTML = renderFormTagsSelectedHtml();
        } else {
          await createAndSelectTag(val);
        }
      } else if (e.key === 'Escape') {
        if (tagDropdown) tagDropdown.style.display = 'none';
        document.querySelector('.sp-tag-input-container')?.classList.remove('open');
      }
    });
  }

  if (tagDropdownToggle && tagDropdown) {
    tagDropdownToggle.addEventListener('click', e => {
      e.stopPropagation();
      const tagWrap = document.querySelector('.sp-tag-input-container');
      if (tagDropdown.style.display === 'block') {
        tagDropdown.style.display = 'none';
        tagWrap?.classList.remove('open');
      } else {
        updateTagDropdown(tagSearchInput ? tagSearchInput.value : '');
      }
    });
  }

  // 7. CSV file input in item form
  const csvFileInput = document.getElementById('sp-csv-file-input');
  if (csvFileInput) {
    csvFileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const activeProj = getActiveProject();
        const imported = parseCsvFile(text);
        imported.forEach(it => {
          it.projectId = activeProj ? activeProj.id : 'proj_default';
        });
        state.items = [...state.items, ...imported];
        await persistVaultChanges();
        showToast(t('settings.csv_import_success', { count: imported.length }));
        clearFormDraft();
        updateState({ activeTab: 'vault', selectedItem: null });
        renderApp();
      } catch (err) {
        alert(t('toasts.csv_import_error') + ': ' + err.message);
      }
    });
  }

  // 8. Title, Password and Form submission
  const titleInput = document.getElementById('sp-item-title');
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      if (titleInput.value.trim()) {
        titleInput.classList.remove('has-error');
        const titleErr = document.getElementById('sp-item-title-error');
        if (titleErr) titleErr.style.display = 'none';
      }
    });
  }

  const pwdInput = document.getElementById('sp-item-password');
  if (pwdInput) {
    pwdInput.value = panelState.currentFormItemPassword || '';
    pwdInput.addEventListener('input', () => {
      panelState.currentFormItemPassword = pwdInput.value;
      if (pwdInput.value) {
        pwdInput.classList.remove('has-error');
        const pwdErr = document.getElementById('sp-item-password-error');
        if (pwdErr) pwdErr.style.display = 'none';
      }
    });
  }

  const itemForm = document.getElementById('sp-item-form');
  if (itemForm) {
    itemForm.addEventListener('input', () => {
      saveFormDraftFromDOM();
    });

    itemForm.addEventListener('submit', async e => {
      e.preventDefault();

      let isValid = true;
      let firstInvalidEl = null;

      const titleVal = titleInput ? titleInput.value.trim() : '';
      const titleErr = document.getElementById('sp-item-title-error');
      if (!titleVal) {
        isValid = false;
        if (titleInput) {
          titleInput.classList.add('has-error', 'sp-shake');
          setTimeout(() => titleInput.classList.remove('sp-shake'), 450);
          if (!firstInvalidEl) firstInvalidEl = titleInput;
        }
        if (titleErr) {
          titleErr.innerText = t('form.title_required');
          titleErr.style.display = 'block';
        }
      } else {
        if (titleInput) titleInput.classList.remove('has-error');
        if (titleErr) titleErr.style.display = 'none';
      }

      const pwdVal = pwdInput ? pwdInput.value : '';
      const pwdErr = document.getElementById('sp-item-password-error');
      if (!pwdVal) {
        isValid = false;
        if (pwdInput) {
          pwdInput.classList.add('has-error', 'sp-shake');
          setTimeout(() => pwdInput.classList.remove('sp-shake'), 450);
          if (!firstInvalidEl) firstInvalidEl = pwdInput;
        }
        if (pwdErr) {
          pwdErr.innerText = t('form.password_required');
          pwdErr.style.display = 'block';
        }
      } else {
        if (pwdInput) pwdInput.classList.remove('has-error');
        if (pwdErr) pwdErr.style.display = 'none';
      }

      if (!isValid) {
        if (firstInvalidEl) firstInvalidEl.focus();
        showToast(t('toasts.fill_required_fields'));
        return;
      }

      const tags = [...panelState.formSelectedTags];
      const url = document.getElementById('sp-item-url')?.value.trim() || '';
      const domain = extractCleanDomain(url);
      await saveItem({
        id: document.getElementById('sp-item-id')?.value || '',
        projectId: document.getElementById('sp-item-project')?.value || '',
        title: titleVal,
        url,
        domain,
        favicon: panelState.formDraft?.favicon || (domain && panelState.cachedFavicons[domain]) || '',
        username: document.getElementById('sp-item-username')?.value.trim() || '',
        password: pwdVal,
        category: tags[0] || '',
        tags,
        notes: document.getElementById('sp-item-notes')?.value.trim() || ''
      }, { renderApp });
      clearFormDraft();
    });
  }
}
