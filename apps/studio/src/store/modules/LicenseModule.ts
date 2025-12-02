import _ from 'lodash'
import { install, Module } from "vuex";
import rawLog from '@bksLogger'
import { State as RootState } from '../index'
import { CloudError } from '@/lib/cloud/ClientHelpers';
import { TransportLicenseKey } from '@/common/transport';
import Vue from "vue"
import { LicenseStatus } from '@/lib/license';
import { SmartLocalStorage } from '@/common/LocalStorage';
import globals from '@/common/globals';
import { CloudClient } from '@/lib/cloud/CloudClient';

interface State {
  initialized: boolean
  licenses: TransportLicenseKey[]
  error: CloudError | Error | null
  now: Date
  status: LicenseStatus,
  installationId: string | null
}

const log = rawLog.scope('LicenseModule')

const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds

const defaultStatus = new LicenseStatus()
Object.assign(defaultStatus, {
  edition: "community",
  condition: "initial",
})

export const LicenseModule: Module<State, RootState>  = {
  namespaced: true,
  state: () => ({
    initialized: false,
    licenses: [],
    error: null,
    now: new Date(),
    status: defaultStatus,
    installationId: null
  }),
  getters: {
    trialLicense(state) {
      return state.licenses.find((l) => l.licenseType === 'TrialLicense')
    },
    realLicenses(state) {
      return state.licenses.filter((l) => l.licenseType !== 'TrialLicense')
    },
    licenseDaysLeft(state) {
      const validUntil = state.status.license.validUntil.getTime()
      const now = state.now.getTime()
      return Math.round((validUntil - now) / oneDay);
    },
    noLicensesFound(state) {
      return state.licenses.length === 0
    },
    isUltimate(state) {
      if (!state) return false
      return state.status.isUltimate
    },
    isCommunity(state) {
      if (!state) return true
      return state.status.isCommunity
    },
    isTrial(state) {
      if (!state) return true
      return state.status.isTrial
    },
    isValidStateExpired(state) {
      // this means a license with lifetime perms, but is no longer valid for software updates
      // so the user has to use an older version of the app.
      return state.status.isValidDateExpired
    }
  },
  mutations: {
    set(state, licenses: TransportLicenseKey[]) {
      state.licenses = licenses
    },
    setInitialized(state, b: boolean) {
      state.initialized = b
    },
    installationId(state, id: string) {
      state.installationId = id
    },
    setNow(state, date: Date) {
      state.now = date
    },
    setStatus(state, status: LicenseStatus) {
      state.status = status
    },
  },
  actions: {
    async init(context) {
      if (context.state.initialized) {
        log.warn('Already initialized')
        return
      }
      await context.dispatch('sync')
      const licenses = await Vue.prototype.$util.send('license/get')
      if (licenses.length === 0) {
        const autoLicense = {} as TransportLicenseKey;
        autoLicense.key = "auto_premium";
        autoLicense.email = "premium@beekeeper.local";
        autoLicense.validUntil = new Date('2099-12-31');
        autoLicense.supportUntil = new Date('2099-12-31');
        autoLicense.maxAllowedAppRelease = null;
        autoLicense.licenseType = "BusinessLicense";
        await Vue.prototype.$util.send('appdb/license/save', { obj: autoLicense });
        await context.dispatch('sync')
      }
      const installationId = await Vue.prototype.$util.send('license/getInstallationId');
      context.commit('installationId', installationId)
      context.commit('setInitialized', true)
    },
    async add(context, { email, key, trial }) {
      if (trial) {
        await Vue.prototype.$util.send('license/createTrialLicense')
        await Vue.prototype.$noty.info("Your 14 day free trial has started, enjoy!")
      } else {
        const license = {} as TransportLicenseKey;
        license.key = key || "premium";
        license.email = email;
        license.validUntil = new Date('2099-12-31');
        license.supportUntil = new Date('2099-12-31');
        license.maxAllowedAppRelease = null;
        license.licenseType = "BusinessLicense";
        await Vue.prototype.$util.send('appdb/license/save', { obj: license });
      }
      SmartLocalStorage.setBool('expiredLicenseEventsEmitted', false)
      await context.dispatch('sync')
    },
    async update(_context, license: TransportLicenseKey) {
      return
    },
    async updateAll(context) {
      return
    },
    async remove(context, license) {
      await Vue.prototype.$util.send('license/remove', { id: license.id })
      await context.dispatch('sync')
    },
    async sync(context) {
      const status = await Vue.prototype.$util.send('license/getStatus')
      const licenses = await Vue.prototype.$util.send('license/get')
      context.commit('set', licenses)
      context.commit('setStatus', status)
      context.commit('setNow', new Date())
    },
  }
}
