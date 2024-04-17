import * as types from './types'

export const ContentScriptDefaultOpts: types.ContentScriptOpts = {
  visualFeedback: true
}

export const ContentScriptDefaultData: types.ContentScriptData = {
  solutions: []
}

/**
 * Content script for Turnstile handling (runs in browser context)
 * @note External modules are not supported here (due to content script isolation)
 */
export class TurnstileContentScript {
  private opts: types.ContentScriptOpts
  private data: types.ContentScriptData

  private baseUrls = [
    'https://challenges.cloudflare.com',
  ]

  constructor(
    opts = ContentScriptDefaultOpts,
    data = ContentScriptDefaultData
  ) {
    // Workaround for https://github.com/esbuild-kit/tsx/issues/113
    if (typeof globalThis.__name === 'undefined') {
      globalThis.__defProp = Object.defineProperty
      globalThis.__name = (target, value) =>
        globalThis.__defProp(target, 'name', { value, configurable: true })
    }

    this.opts = opts
    this.data = data
  }

  private async _waitUntilDocumentReady() {
    return new Promise(function(resolve) {
      if (!document || !window) return resolve(null)
      const loadedAlready = /^loaded|^i|^c/.test(document.readyState)
      if (loadedAlready) return resolve(null)

      function onReady() {
        resolve(null)
        document.removeEventListener('DOMContentLoaded', onReady)
        window.removeEventListener('load', onReady)
      }

      document.addEventListener('DOMContentLoaded', onReady)
      window.addEventListener('load', onReady)
    })
  }

  private _paintCaptchaBusy($iframe: HTMLIFrameElement) {
    try {
      if (this.opts.visualFeedback) {
        $iframe.style.filter = `opacity(60%) hue-rotate(400deg)` // violet
      }
    } catch (error) {
      // noop
    }
    return $iframe
  }

  /** Find active challenges */
  private _findActiveChallenges() {
    const nodeList = document.querySelectorAll<HTMLIFrameElement>(
      this.baseUrls.map(url => `iframe[src*='${url}'][src*='turnstile']`).join(',')
    )
    return Array.from(nodeList)
  }

  private _extractInfoFromIframes(iframes: HTMLIFrameElement[]) {
    return iframes
      .map(el => el.src)
      .map(url => {
        // https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/34hih/0x4AAAAAAADnPIDROrmt1Wwj/light/normal

        const sitekey = (url.match(/\/(\w+)\/\w+\/\w+$/) || [])[1];
        const result: types.CaptchaInfo = {
          _vendor: 'turnstile',
          url: document.location.href,
          id: sitekey,
          sitekey: sitekey
        }
        return result
      })
  }

  public async findRecaptchas() {
    const result = {
      captchas: [] as types.CaptchaInfo[],
      error: null as null | Error
    }
    try {
      await this._waitUntilDocumentReady()
      const iframes = [
        ...this._findActiveChallenges()
      ]
      if (!iframes.length) {
        return result
      }
      result.captchas = this._extractInfoFromIframes(iframes)
      iframes.forEach(el => {
        this._paintCaptchaBusy(el)
      })
    } catch (error) {
      result.error = error
      return result
    }
    return result
  }

  public async enterRecaptchaSolutions() {
    const result = {
      solved: [] as types.CaptchaSolved[],
      error: null as any
    }
    try {
      await this._waitUntilDocumentReady()

      const solutions = this.data.solutions
      if (!solutions || !solutions.length) {
        result.error = 'No solutions provided'
        return result
      }
      result.solved = solutions
        .filter(solution => solution._vendor === 'turnstile')
        .filter(solution => solution.hasSolution === true)
        .map(solution => {
          window.postMessage(
            JSON.stringify({
              id: solution.id,
              label: 'challenge-closed',
              source: 'turnstile',
              contents: {
                event: 'challenge-passed',
                expiration: 120,
                response: solution.text
              }
            }),
            '*'
          )
          return {
            _vendor: solution._vendor,
            id: solution.id,
            isSolved: true,
            solvedAt: new Date()
          }
        })
    } catch (error) {
      result.error = error
      return result
    }
    return result
  }
}
