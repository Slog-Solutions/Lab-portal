/*
 * Ready-made content runtime (Ser 4 Content Exercise). Plain browser JS, no
 * build step: a pack's index.html sets window.LAB_EXERCISE = { questions }
 * and includes this file. It renders the questions, marks them, and reports
 * the score and every answer to the language lab through the standard
 * SCORM 1.2 API (window.API found on a parent window) — the same channel an
 * imported publisher package uses. Opened outside the lab it still works,
 * it just has nobody to report to.
 */
(function () {
  'use strict';

  function findAPI(win) {
    try {
      for (var i = 0; win && i < 10; i++) {
        if (win.API) return win.API;
        if (win.parent === win) break;
        win = win.parent;
      }
    } catch (e) {
      // Cross-origin parent (an Electron seat's app:// page): fall through.
    }
    return null;
  }

  /** Same calls, sent to the lab's exercise window by postMessage when the
   * parent can't be reached directly (different origin). */
  function messageAPI() {
    if (window.parent === window) return null;
    function post(method, args) {
      window.parent.postMessage({ source: 'lab-exercise', method: method, args: args }, '*');
      return 'true';
    }
    return {
      LMSInitialize: function () { return post('LMSInitialize', []); },
      LMSSetValue: function (k, v) { return post('LMSSetValue', [k, v]); },
      LMSCommit: function () { return post('LMSCommit', []); },
      LMSFinish: function () { return post('LMSFinish', []); },
    };
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var api = findAPI(window) || messageAPI();
  if (api) api.LMSInitialize('');

  var data = window.LAB_EXERCISE || { questions: [] };
  var root = document.getElementById('questions');
  var inputs = {};

  data.questions.forEach(function (q, n) {
    var box = el('fieldset', { class: 'q', id: 'q-' + q.id });
    box.appendChild(el('legend', {}, n + 1 + '. ' + q.prompt));
    if (q.type === 'choice') {
      q.choices.forEach(function (c) {
        var label = el('label', { class: 'choice' });
        var radio = el('input', { type: 'radio', name: q.id, value: c });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(' ' + c));
        box.appendChild(label);
      });
      inputs[q.id] = function () {
        var picked = box.querySelector('input:checked');
        return picked ? picked.value : '';
      };
    } else {
      var input = el('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Answer to question ' + (n + 1) });
      box.appendChild(input);
      inputs[q.id] = function () {
        return input.value;
      };
    }
    box.appendChild(el('p', { class: 'feedback' }));
    root.appendChild(box);
  });

  var button = document.getElementById('submit');
  button.addEventListener('click', function () {
    var correct = 0;
    data.questions.forEach(function (q, i) {
      var given = inputs[q.id]();
      var answers = [].concat(q.answer);
      var ok = answers.some(function (a) {
        return norm(a) === norm(given);
      });
      if (ok) correct++;
      var box = document.getElementById('q-' + q.id);
      box.className = 'q ' + (ok ? 'right' : 'wrong');
      box.querySelector('.feedback').textContent = ok ? 'Correct' : 'Answer: ' + answers[0];
      if (api) {
        var p = 'cmi.interactions.' + i + '.';
        api.LMSSetValue(p + 'id', q.id);
        api.LMSSetValue(p + 'type', q.type === 'choice' ? 'choice' : 'fill-in');
        api.LMSSetValue(p + 'description', q.prompt);
        api.LMSSetValue(p + 'student_response', given);
        api.LMSSetValue(p + 'correct_responses.0.pattern', answers[0]);
        api.LMSSetValue(p + 'result', ok ? 'correct' : 'wrong');
      }
    });
    var score = data.questions.length ? Math.round((correct / data.questions.length) * 100) : 0;
    document.getElementById('result').textContent = 'You scored ' + correct + ' out of ' + data.questions.length + ' (' + score + '%).';
    button.disabled = true;
    Array.prototype.forEach.call(document.querySelectorAll('#questions input'), function (i) {
      i.disabled = true;
    });
    if (api) {
      api.LMSSetValue('cmi.core.score.raw', String(score));
      api.LMSSetValue('cmi.core.lesson_status', score >= 50 ? 'passed' : 'failed');
      api.LMSCommit('');
      api.LMSFinish('');
    }
  });
})();
