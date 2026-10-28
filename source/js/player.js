/*
 * player.js — step / back / play timing shared by the templates.
 * Holds no DOM; each template draws its own controls and calls these methods.
 *
 *   var p = new Player({ onChange: function (i) {...}, onState: function (playing) {...} });
 *   p.reset(count, start); p.next(); p.prev(); p.go(i); p.toggle(); p.setSpeed(ms);
 */
(function (root) {
  'use strict';

  function Player(opts) {
    this.opts = opts || {};
    this.count = 0; this.i = 0; this.timer = null; this.ms = this.opts.ms || 750;
  }
  Player.prototype.reset = function (count, start) {
    this.pause();
    this.count = count;
    this.go(start === undefined ? 0 : start);
  };
  Player.prototype.go = function (i) {
    if (!this.count) { this.i = 0; if (this.opts.onChange) this.opts.onChange(-1); return; }
    this.i = Math.max(0, Math.min(this.count - 1, i));
    if (this.opts.onChange) this.opts.onChange(this.i);
  };
  Player.prototype.next = function () { this.go(this.i + 1); };
  Player.prototype.prev = function () { this.go(this.i - 1); };
  Player.prototype.first = function () { this.go(0); };
  Player.prototype.last = function () { this.go(this.count - 1); };
  Player.prototype.atEnd = function () { return this.i >= this.count - 1; };
  Player.prototype.play = function () {
    var self = this;
    if (this.count < 2) return;
    if (this.atEnd()) this.go(0);
    clearInterval(this.timer);
    this.timer = setInterval(function () {
      if (self.atEnd()) return self.pause();
      self.next();
    }, this.ms);
    if (this.opts.onState) this.opts.onState(true);
  };
  Player.prototype.pause = function () {
    var was = !!this.timer;
    clearInterval(this.timer);
    this.timer = null;
    if (was && this.opts.onState) this.opts.onState(false);
  };
  Player.prototype.toggle = function () { if (this.timer) this.pause(); else this.play(); };
  Player.prototype.playing = function () { return !!this.timer; };
  Player.prototype.setSpeed = function (ms) { this.ms = ms; if (this.timer) { this.pause(); this.play(); } };

  root.Player = Player;
})(this);
