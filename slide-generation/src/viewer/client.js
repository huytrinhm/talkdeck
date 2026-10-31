/* Owned iframe runtime. This file is embedded verbatim; no source JSX is executed. */
(() => {
  const { channel, version } = VIEWER_CONFIG;
  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const exits = document.getElementById('exits');
  const style = document.getElementById('render-css');
  let sequence = -1, generation = 0, current = null, preparing = false, frame = 0;
  let lastVisual = new Map(), lastVisible = null, frozen = null, animations = new Map(), lastFrameAt = performance.now();
  let scale = 1;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const keys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const mix = (a, b, t) => a + (b - a) * clamp(t);
  function emit(type, message, extra = {}) {
    parent.postMessage({ version, channel, type, monotonicMs: performance.now(), timeOriginMs: performance.timeOrigin,
      ...(message ? { publicationId: message.publicationId, revision: message.revision, slideId: message.slideId, sequence: message.sequence, build: message.build } : {}), ...extra }, '*');
  }
  function fit() {
    scale = Math.min(innerWidth / 1920, innerHeight / 1080) || 1;
    viewport.style.transform = `translate(${(innerWidth - 1920 * scale) / 2}px,${(innerHeight - 1080 * scale) / 2}px) scale(${scale})`;
  }
  addEventListener('resize', fit); fit();
  function valid(message) {
    const common = ['version', 'channel', 'type', 'sequence', 'revision', 'build', 'holdIds'];
    if (!message || message.version !== version || message.channel !== channel || !integer(message.sequence)
      || !id(message.revision) || !integer(message.build) || !Array.isArray(message.holdIds)
      || message.holdIds.length > 10000 || !message.holdIds.every(id)) return false;
    if (message.type === 'build') return keys(message, common);
    if (message.type !== 'publish' || !keys(message, [...common, 'publicationId', 'slideId', 'html', 'css', 'mode', 'readiness', 'motion'])) return false;
    const { motion, readiness } = message;
    return id(message.publicationId) && id(message.slideId) && typeof message.html === 'string' && message.html.length <= 16000000
      && typeof message.css === 'string' && message.css.length <= 16000000 && ['editor', 'presentation'].includes(message.mode)
      && keys(readiness, ['revision', 'ready']) && id(readiness.revision) && typeof readiness.ready === 'boolean'
      && keys(motion, ['durationMs', 'stiffness', 'damping'])
      && finite(motion.durationMs) && motion.durationMs >= 0 && motion.durationMs <= 3000
      && finite(motion.stiffness) && motion.stiffness >= 20 && motion.stiffness <= 1000
      && finite(motion.damping) && motion.damping >= 1 && motion.damping <= 100;
  }
  function safeFragment(html) {
    const template = document.createElement('template'); template.innerHTML = html;
    if (template.content.children.length !== 1) throw new Error('html_root');
    if (template.content.querySelector('script,iframe,object,embed,form,input,button,textarea,select,link,meta,base,style,foreignObject,animate,animateTransform,set')) throw new Error('active_html');
    const identities = new Set();
    for (const element of template.content.querySelectorAll('*')) {
      for (const attr of element.attributes) {
        if (/^on/i.test(attr.name) || ['srcdoc', 'action', 'formaction', 'href', 'xlink:href', 'srcset'].includes(attr.name)) throw new Error('active_attribute');
        if (attr.name === 'src' && !/^(data:image\/(png|jpeg|webp|svg\+xml);base64,|blob:)/.test(attr.value)) throw new Error('external_asset');
      }
      if (element.hasAttribute('data-viewer-held')) throw new Error('reserved_attribute');
      const identity = element.getAttribute('data-node');
      if (identity !== null) {
        if (!id(identity) || identities.has(identity)) throw new Error('duplicate_identity');
        identities.add(identity);
      }
      if (element.hasAttribute('data-build') && !/^\d+$/.test(element.getAttribute('data-build'))) throw new Error('build_value');
    }
    return template;
  }
  function applyBuild(message) {
    const held = new Set(message.holdIds);
    for (const node of stage.querySelectorAll('[data-node]')) {
      let ancestor = node, hidden = false;
      while (ancestor && ancestor !== stage) {
        if (held.has(ancestor.getAttribute('data-node')) || Number(ancestor.getAttribute('data-build') || 0) > message.build) { hidden = true; break; }
        ancestor = ancestor.parentElement;
      }
      node.toggleAttribute('data-viewer-held', message.mode === 'presentation' && hidden);
    }
  }
  function visibleIds() {
    const ids = new Set();
    for (const node of stage.querySelectorAll('[data-content]')) {
      const box = rect(node), owner = node.closest('[data-node]');
      if (!owner || node.closest('[data-pending]') || box.width <= 0 || box.height <= 0
        || box.x + box.width <= 0 || box.y + box.height <= 0 || box.x >= 1920 || box.y >= 1080) continue;
      let ancestor = node, visible = true;
      while (ancestor && ancestor !== stage) {
        const computed = getComputedStyle(ancestor);
        if (computed.visibility === 'hidden' || computed.display === 'none' || Number(computed.opacity) === 0) { visible = false; break; }
        ancestor = ancestor.parentElement;
      }
      if (visible) ids.add(owner.getAttribute('data-node'));
    }
    return [...ids];
  }
  function rect(element) {
    const box = element.getBoundingClientRect(), base = viewport.getBoundingClientRect();
    return { x: (box.left - base.left) / scale, y: (box.top - base.top) / scale, width: box.width / scale, height: box.height / scale };
  }
  function color(text) {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(text);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 1)] : null;
  }
  function rgba(from, to, t) {
    return `rgba(${from.slice(0, 3).map((n, i) => Math.round(clamp(mix(n, to[i], t), 0, 255))).join(',')},${clamp(mix(from[3], to[3], t))})`;
  }
  function numeric(text) {
    const match = /^([^\d]*?)([+-]?\d[\d,]*(?:\.\d+)?)([^\d]*)$/.exec(text);
    if (!match) return null;
    const prefix = match[1], raw = match[2], suffix = match[3];
    if ((raw.match(/,/g) || []).length && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) return null;
    const value = Number(raw.replaceAll(',', '')) * (prefix.includes('-') ? -1 : 1);
    if (!Number.isFinite(value)) return null;
    return { value, prefix: prefix.replace(/[+-]/g, ''), suffix, decimals: raw.split('.')[1]?.length || 0,
      commas: raw.includes(','), signBeforePrefix: /^[+-]/.test(prefix), explicitPlus: prefix.includes('+') || raw.startsWith('+') };
  }
  function numericText(parsed, value) {
    const sign = value < 0 ? '-' : parsed.explicitPlus ? '+' : '';
    let digits = Math.abs(value).toFixed(parsed.decimals);
    if (parsed.commas) { const parts = digits.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); digits = parts.join('.'); }
    return parsed.signBeforePrefix ? `${sign}${parsed.prefix}${digits}${parsed.suffix}` : `${parsed.prefix}${sign}${digits}${parsed.suffix}`;
  }
  function ownStat(element) {
    const stat = element.matches('[data-stat-value]') ? element : element.querySelector('[data-stat-value]');
    return stat?.closest('[data-node]') === element ? stat : null;
  }
  function snapshot() {
    const result = new Map();
    for (const element of stage.querySelectorAll('[data-node]')) {
      const computed = getComputedStyle(element), oldMotion = animations.get(element.getAttribute('data-node'));
      result.set(element.getAttribute('data-node'), { element, box: rect(element),
        color: color(computed.color), backgroundColor: color(computed.backgroundColor), opacity: Number(computed.opacity),
        parent: element.parentElement?.closest('[data-node]')?.getAttribute('data-node'),
        stat: ownStat(element)?.textContent ?? null,
        vx: oldMotion?.vx || 0, vy: oldMotion?.vy || 0,
        visible: computed.visibility !== 'hidden' });
    }
    return result;
  }
  function freezeElement(element, retainedIds) {
    const clone = element.cloneNode(true), originals = [element, ...element.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < originals.length; i++) {
      if (i > 0 && retainedIds?.has(originals[i].getAttribute('data-node'))) { copies[i].remove(); continue; }
      const computed = getComputedStyle(originals[i]);
      for (const prop of computed) copies[i].style.setProperty(prop, computed.getPropertyValue(prop));
      copies[i].removeAttribute('id'); copies[i].removeAttribute('data-node');
      copies[i].removeAttribute('data-content');
    }
    return clone;
  }
  function clearFrame() { cancelAnimationFrame(frame); frame = 0; }
  function domEquivalent(message) {
    const expected = safeFragment(message.html).content;
    const clone = stage.cloneNode(true);
    for (const node of clone.querySelectorAll('[data-viewer-held]')) node.removeAttribute('data-viewer-held');
    return clone.innerHTML === (() => { const holder = document.createElement('div'); holder.append(expected); return holder.innerHTML; })();
  }
  function clearInlineStyle(node) {
    node.removeAttribute('style');
    // Flush Chromium's lazily synchronized CSSOM attribute, then remove a recreated empty attribute.
    if (node.getAttribute('style') !== null) node.removeAttribute('style');
  }
  function restoreMotionStyles(motion) {
    if (motion.originalStyle === null) clearInlineStyle(motion.element);
    else motion.element.setAttribute('style', motion.originalStyle);
    if (motion.statElement) motion.statElement.textContent = motion.statTarget;
  }
  function painted(message, token) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== generation || message.sequence !== current?.sequence) return;
      emit('painted', message, { visibleNodeIds: visibleIds() });
    }));
  }
  function finish(message, token) {
    if (token !== generation) return;
    for (const motion of animations.values()) restoreMotionStyles(motion);
    animations.clear(); exits.replaceChildren(); exits.style.opacity = '';
    const targetNodes = new Map([...safeFragment(current.html).content.querySelectorAll('[data-node]')].map(n => [n.getAttribute('data-node'), n]));
    for (const node of stage.querySelectorAll('[data-node]')) {
      const target = targetNodes.get(node.getAttribute('data-node'));
      if (target?.hasAttribute('style')) node.setAttribute('style', target.getAttribute('style'));
      else clearInlineStyle(node);
    }
    applyBuild(current); lastVisual = snapshot();
    emit('settled', current, { domEquivalent: domEquivalent(current), visibleNodeIds: visibleIds() });
  }
  async function assetsReady() {
    let timer;
    try {
      await Promise.race([
        Promise.all([document.fonts.ready, ...[...stage.querySelectorAll('img')].map(img => img.decode())]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('asset_timeout')), 10000); }),
      ]);
      if ([...document.fonts].some(font => font.status === 'error')) throw new Error('font_failed');
    } finally { clearTimeout(timer); }
  }
  async function publish(message) {
    // A server confirmation of a locally displayed immutable artifact only changes
    // publication identity. Do not rebuild the DOM or restart motion for it.
    if (!preparing && !animations.size && current && current.html === message.html && current.css === message.css
      && current.slideId === message.slideId && current.mode === message.mode && current.build === message.build
      && JSON.stringify(current.holdIds) === JSON.stringify(message.holdIds)) {
      current = message; sequence = message.sequence;
      if (lastVisible) lastVisible.message = message;
      emit('applied', current); painted(current, generation);
      emit('settled', current, { domEquivalent: domEquivalent(current), visibleNodeIds: visibleIds() });
      return;
    }
    const token = ++generation;
    if (preparing && current) emit('refused', current, { code: 'superseded_before_paint' });
    clearFrame();
    // Immediate navigation does not need motion snapshots, computed-style cloning,
    // exit layers or per-node animation preparation. Keep normal updates animated.
    if (message.motion.durationMs === 0) {
      if (!preparing && lastVisible) {
        const old = style.textContent === message.css ? stage.cloneNode(true) : freezeElement(stage);
        for (const node of [old, ...old.querySelectorAll('*')]) {
          node.removeAttribute('id'); node.removeAttribute('data-node'); node.removeAttribute('data-content');
        }
        old.style.position = 'absolute'; old.style.inset = '0';
        exits.replaceChildren(old);
      }
      preparing = true; current = message; sequence = message.sequence;
      animations.clear(); exits.style.opacity = '';
      stage.style.visibility = 'hidden';
      stage.replaceChildren(safeFragment(message.html).content);
      if (style.textContent !== message.css) style.textContent = message.css;
      try { await assetsReady(); }
      catch (error) {
        if (token !== generation) return;
        stage.innerHTML = lastVisible?.html ?? ''; style.textContent = lastVisible?.css ?? '';
        stage.style.visibility = ''; preparing = false; current = lastVisible?.message ?? null; exits.replaceChildren();
        if (current) applyBuild(current);
        emit('refused', message, { code: error.message === 'asset_timeout' || error.message === 'font_failed' ? error.message : 'asset_failed' });
        return;
      }
      if (token !== generation) return;
      preparing = false; stage.style.visibility = ''; applyBuild(current); exits.replaceChildren();
      lastVisible = { message: current, html: message.html, css: message.css }; lastVisual = new Map();
      emit('applied', current); painted(current, token);
      emit('settled', current, { domEquivalent: domEquivalent(current), visibleNodeIds: visibleIds() });
      return;
    }
    const previousMessage = lastVisible?.message ?? null;
    const previous = preparing ? lastVisual : snapshot();
    const template = safeFragment(message.html);
    const targetIds = new Set([...template.content.querySelectorAll('[data-node]')].map(n => n.getAttribute('data-node')));
    const removed = [], textChanges = new Set();
    if (!preparing) {
      frozen = freezeElement(stage);
      for (const [identity, old] of previous) {
        const removedParent = old.parent && previous.has(old.parent) && !targetIds.has(old.parent);
        if (!targetIds.has(identity) && old.visible && !removedParent) removed.push({ old, clone: freezeElement(old.element, targetIds) });
        const newElement = [...template.content.querySelectorAll('[data-node]')].find(n => n.getAttribute('data-node') === identity);
        const newStat = newElement ? ownStat(newElement)?.textContent : null;
        if (old.stat !== null && newStat !== null && newStat !== undefined && old.stat !== newStat) {
          const a = numeric(old.stat), b = numeric(newStat);
          if (!a || !b || a.prefix !== b.prefix || a.suffix !== b.suffix) {
            textChanges.add(identity);
            if (old.visible) removed.push({ old, clone: freezeElement(old.element, targetIds) });
          }
        }
      }
      exits.replaceChildren(frozen); frozen.style.position = 'absolute'; frozen.style.inset = '0';
    }
    lastVisual = previous; preparing = true; current = message; sequence = message.sequence;
    animations.clear(); stage.style.visibility = 'hidden';
    stage.replaceChildren(template.content); style.textContent = message.css;
    try { await assetsReady(); }
    catch (error) {
      if (token !== generation) return;
      stage.innerHTML = lastVisible?.html ?? ''; style.textContent = lastVisible?.css ?? ''; stage.style.visibility = '';
      preparing = false; current = lastVisible?.message ?? null; exits.replaceChildren(); exits.style.opacity = '';
      if (current) applyBuild(current);
      emit('refused', message, { code: error.message === 'asset_timeout' || error.message === 'font_failed' ? error.message : 'asset_failed' }); return;
    }
    if (token !== generation) return;
    const next = snapshot();
    const crossfade = previousMessage && previousMessage.slideId !== message.slideId;
    exits.replaceChildren(); exits.style.opacity = '';
    if (crossfade && frozen) exits.append(frozen);
    else for (const { old, clone } of removed) {
      clone.style.position = 'absolute'; clone.style.left = `${old.box.x}px`; clone.style.top = `${old.box.y}px`;
      clone.style.width = `${old.box.width}px`; clone.style.height = `${old.box.height}px`;
      clone.style.margin = '0'; clone.style.transform = 'none'; exits.append(clone);
    }
    for (const [identity, target] of next) {
      const old = crossfade ? undefined : previous.get(identity), element = target.element;
      const statElement = ownStat(element);
      const statTarget = statElement?.textContent ?? null;
      const fromNumber = old?.stat !== null && old?.stat !== undefined ? numeric(old.stat) : null;
      const toNumber = statTarget !== null ? numeric(statTarget) : null;
      const numericCompatible = fromNumber && toNumber && fromNumber.prefix === toNumber.prefix && fromNumber.suffix === toNumber.suffix;
      const retainedDescendant = [...element.querySelectorAll('[data-node]')].some(n => previous.has(n.getAttribute('data-node')));
      animations.set(identity, { element, originalStyle: element.getAttribute('style'), target: target.box,
        originalTransform: getComputedStyle(element).transform === 'none' ? '' : getComputedStyle(element).transform,
        x: old?.box.x ?? target.box.x, y: old?.box.y ?? target.box.y,
        fromWidth: old?.box.width ?? target.box.width, fromHeight: old?.box.height ?? target.box.height,
        vx: old?.vx ?? 0, vy: old?.vy ?? 0, fromOpacity: textChanges.has(identity) ? 0 : old?.opacity ?? (retainedDescendant ? target.opacity : 0), toOpacity: target.opacity,
        fromColor: old?.color ?? target.color, toColor: target.color,
        fromBackground: old?.backgroundColor ?? target.backgroundColor, toBackground: target.backgroundColor,
        statElement, statTarget, fromNumber: numericCompatible ? fromNumber : null, toNumber: numericCompatible ? toNumber : null });
    }
    preparing = false; stage.style.visibility = ''; applyBuild(current);
    lastVisible = { message: current, html: message.html, css: message.css };
    const startedAt = performance.now(); lastFrameAt = startedAt;
    if (message.motion.durationMs === 0) { emit('applied', current); painted(current, token); finish(current, token); return; }
    function animate(now) {
      if (token !== generation) return;
      const delta = clamp((now - lastFrameAt) / 1000, 0, 0.032); lastFrameAt = now;
      const progress = clamp((now - startedAt) / message.motion.durationMs), eased = 1 - Math.pow(1 - progress, 3);
      let moving = false;
      for (const motion of animations.values()) restoreMotionStyles(motion);
      for (const motion of animations.values()) {
        const { element, target } = motion;
        // Movement springs retain velocity through interruption; every other property is bounded interpolation.
        const steps = Math.max(1, Math.ceil(delta / 0.008)), dt = delta / steps;
        for (let step = 0; step < steps; step++) {
          motion.vx += (-message.motion.stiffness * (motion.x - target.x) - message.motion.damping * motion.vx) * dt;
          motion.vy += (-message.motion.stiffness * (motion.y - target.y) - message.motion.damping * motion.vy) * dt;
          motion.x += motion.vx * dt; motion.y += motion.vy * dt;
        }
        moving ||= Math.abs(motion.x - target.x) + Math.abs(motion.y - target.y) + Math.abs(motion.vx) + Math.abs(motion.vy) > 0.1;
        const width = Math.max(0, mix(motion.fromWidth, target.width, eased)), height = Math.max(0, mix(motion.fromHeight, target.height, eased));
        const actual = rect(element), ownScaleX = actual.width / (element.offsetWidth || actual.width || 1), ownScaleY = actual.height / (element.offsetHeight || actual.height || 1);
        const sx = actual.width ? width / actual.width : 1, sy = actual.height ? height / actual.height : 1;
        element.style.transformOrigin = '0 0';
        const dx = (motion.x - actual.x) / (ownScaleX || 1), dy = (motion.y - actual.y) / (ownScaleY || 1);
        const transform = (x, y) => `translate(${x}px,${y}px) scale(${Math.max(0, sx)},${Math.max(0, sy)}) ${motion.originalTransform}`;
        element.style.transform = transform(dx, dy);
        // Authored translate and nested parent scaling can move the origin after scaling; correct measured residual.
        const rendered = rect(element);
        element.style.transform = transform(dx + (motion.x - rendered.x) / (ownScaleX || 1), dy + (motion.y - rendered.y) / (ownScaleY || 1));
        element.style.opacity = String(clamp(mix(motion.fromOpacity, motion.toOpacity, eased)));
        if (motion.fromColor && motion.toColor) element.style.color = rgba(motion.fromColor, motion.toColor, eased);
        if (motion.fromBackground && motion.toBackground) element.style.backgroundColor = rgba(motion.fromBackground, motion.toBackground, eased);
        if (motion.statElement && motion.fromNumber && motion.toNumber && progress < 1) {
          const value = mix(motion.fromNumber.value, motion.toNumber.value, eased);
          motion.statElement.textContent = numericText({ ...motion.toNumber, decimals: Math.max(motion.fromNumber.decimals, motion.toNumber.decimals) }, value);
        }
      }
      exits.style.opacity = String(1 - eased);
      if (progress === 1 && (!moving || now - startedAt > Math.max(2000, message.motion.durationMs * 3))) { exits.style.opacity = ''; finish(message, token); }
      else frame = requestAnimationFrame(animate);
    }
    animate(startedAt);
    emit('applied', current); painted(current, token);
  }
  addEventListener('message', event => {
    if (event.source !== parent || !valid(event.data)) return;
    const message = event.data;
    if (message.sequence <= sequence) { emit('refused', message.type === 'publish' ? message : current, { code: 'stale_sequence' }); return; }
    if (message.type === 'publish') {
      if (message.mode === 'presentation' && (!message.readiness.ready || message.readiness.revision !== message.revision)) {
        emit('refused', message, { code: 'presentation_not_ready' }); return;
      }
      try { safeFragment(message.html); } catch (error) { emit('refused', message, { code: error.message }); return; }
      publish(message).catch(() => emit('refused', message, { code: 'viewer_failed' }));
    } else {
      if (!current || current.revision !== message.revision) { emit('refused', current, { code: 'build_revision' }); return; }
      sequence = message.sequence; current = { ...current, build: message.build, holdIds: message.holdIds, sequence };
      if (lastVisible && lastVisible.message.revision === current.revision) lastVisible.message = current;
      if (!preparing) {
        applyBuild(current);
        emit('applied', current);
        painted(current, generation);
        if (!animations.size) emit('settled', current, { domEquivalent: domEquivalent(current), visibleNodeIds: visibleIds() });
      }
    }
  });
  emit('ready');
})();
