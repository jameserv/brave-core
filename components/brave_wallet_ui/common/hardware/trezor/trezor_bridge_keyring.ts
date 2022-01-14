/* Copyright (c) 2021 The Brave Authors. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { publicToAddress, toChecksumAddress, bufferToHex } from 'ethereumjs-util'
import { BraveWallet } from '../../../constants/types'
import { getLocale } from '../../../../common/locale'
import {
  TrezorCommand,
  UnlockResponsePayload,
  GetAccountsResponsePayload,
  TrezorAccount,
  SignTransactionCommandPayload,
  TrezorFrameCommand,
  SignTransactionResponsePayload,
  SignMessageCommandPayload,
  SignMessageResponsePayload,
  TrezorErrorsCodes,
  SignTransactionResponse,
  SignMessageResponse,
  TrezorGetAccountsResponse
} from './trezor-messages'
import { sendTrezorCommand, closeTrezorBridge } from './trezor-bridge-transport'
import { hardwareDeviceIdFromAddress } from '../hardwareDeviceIdFromAddress'
import {
  GetAccountsHardwareOperationResult,
  HardwareOperationResult,
  SignHardwareMessageOperationResult,
  SignHardwareTransactionOperationResult
} from '../../hardware_operations'
import { Unsuccessful } from 'trezor-connect'
import { TrezorKeyring } from '../interfaces'
import { HardwareVendor } from '../../api/hardware_keyrings'
import { TrezorDerivationPaths } from '../types'

export default class TrezorBridgeKeyring extends TrezorKeyring {
  private unlocked: boolean = false
  protected deviceId: string

  type = (): HardwareVendor => {
    return BraveWallet.TREZOR_HARDWARE_VENDOR
  }

  coin = (): BraveWallet.CoinType => {
    return BraveWallet.CoinType.ETH
  }

  isUnlocked = (): boolean => {
    return this.unlocked
  }

  cancelOperation = async () => {
    closeTrezorBridge()
  }

  unlock = async (): Promise<HardwareOperationResult> => {
    const data = await this.sendTrezorCommand<UnlockResponsePayload>({
      id: TrezorCommand.Unlock,
      origin: window.origin,
      command: TrezorCommand.Unlock
    })
    if (data === TrezorErrorsCodes.BridgeNotReady ||
        data === TrezorErrorsCodes.CommandInProgress) {
      return this.createErrorFromCode(data)
    }
    this.unlocked = data.payload.success
    if (!data.payload.success) {
      const response: Unsuccessful = data.payload as Unsuccessful
      const error = response.payload?.error ?? getLocale('braveWalletUnlockError')
      const code = response.payload?.code ?? ''
      return { success: false, error: error, code: code }
    }
    return { success: this.unlocked }
  }

  getAccounts = async (from: number, to: number, scheme: string): Promise<GetAccountsHardwareOperationResult> => {
    if (!this.isUnlocked()) {
      const unlocked = await this.unlock()
      if (!unlocked.success) {
        return unlocked
      }
    }
    from = (from >= 0) ? from : 0
    const paths = []
    const addZeroPath = (from > 0 || to < 0)
    if (addZeroPath) {
      // Add zero address to calculate device id.
      paths.push(this.getPathForIndex(0, TrezorDerivationPaths.Default))
    }
    for (let i = from; i <= to; i++) {
      paths.push(this.getPathForIndex(i, scheme))
    }
    return this.getAccountsFromDevice(paths, addZeroPath)
  }

  signTransaction = async (path: string, txInfo: BraveWallet.TransactionInfo, chainId: string): Promise<SignHardwareTransactionOperationResult> => {
    if (!this.isUnlocked()) {
      const unlocked = await this.unlock()
      if (!unlocked.success) {
        return unlocked
      }
    }
    const data = await this.sendTrezorCommand<SignTransactionResponsePayload>({
      command: TrezorCommand.SignTransaction,
      id: txInfo.id,
      payload: this.prepareTransactionPayload(path, txInfo, chainId),
      origin: window.origin
    })
    if (data === TrezorErrorsCodes.BridgeNotReady ||
        data === TrezorErrorsCodes.CommandInProgress) {
      return this.createErrorFromCode(data)
    }
    const response: SignTransactionResponse = data.payload
    if (!response.success) {
      return { success: false, error: response.payload.error, code: response.payload.code }
    }
    return { success: true, payload: response.payload }
  }

  signPersonalMessage = async (path: string, message: string): Promise<SignHardwareMessageOperationResult> => {
    if (!this.isUnlocked()) {
      const unlocked = await this.unlock()
      if (!unlocked.success) {
        return unlocked
      }
    }
    const data = await this.sendTrezorCommand<SignMessageResponsePayload>({
      command: TrezorCommand.SignMessage,
      id: path,
      payload: this.prepareSignMessagePayload(path, message),
      origin: window.origin
    })
    if (data === TrezorErrorsCodes.BridgeNotReady ||
        data === TrezorErrorsCodes.CommandInProgress) {
      return this.createErrorFromCode(data)
    }
    const response: SignMessageResponse = data.payload
    if (!response.success) {
      const unsuccess = response.payload
      return { success: false, error: unsuccess.error, code: unsuccess.code }
    }
    return { success: true, payload: response.payload.signature }
  }

  private async sendTrezorCommand<T> (command: TrezorFrameCommand): Promise<T | TrezorErrorsCodes> {
    return sendTrezorCommand<T>(command)
  }

  private readonly getHashFromAddress = async (address: string) => {
    return hardwareDeviceIdFromAddress(address)
  }

  private readonly getDeviceIdFromAccountsList = async (accountsList: TrezorAccount[]) => {
    const zeroPath = this.getPathForIndex(0, TrezorDerivationPaths.Default)
    for (const value of accountsList) {
      if (value.serializedPath !== zeroPath) {
        continue
      }
      const address = this.publicKeyToAddress(value.publicKey)
      return this.getHashFromAddress(address)
    }
    return ''
  }

  private prepareTransactionPayload = (path: string, txInfo: BraveWallet.TransactionInfo, chainId: string): SignTransactionCommandPayload => {
    const isEIP1559Transaction = txInfo.txData.maxPriorityFeePerGas !== '' && txInfo.txData.maxFeePerGas !== ''
    if (isEIP1559Transaction) {
      return this.createEIP1559TransactionPayload(path, txInfo, chainId)
    }
    return this.createLegacyTransactionPayload(path, txInfo, chainId)
  }

  private createEIP1559TransactionPayload = (path: string, txInfo: BraveWallet.TransactionInfo, chainId: string): SignTransactionCommandPayload => {
    return {
      path: path,
      transaction: {
        to: txInfo.txData.baseData.to,
        value: txInfo.txData.baseData.value,
        data: bufferToHex(Buffer.from(txInfo.txData.baseData.data)).toString(),
        chainId: parseInt(chainId, 16),
        nonce: txInfo.txData.baseData.nonce,
        gasLimit: txInfo.txData.baseData.gasLimit,
        maxFeePerGas: txInfo.txData.maxFeePerGas,
        maxPriorityFeePerGas: txInfo.txData.maxPriorityFeePerGas
      }
    }
  }

  private createLegacyTransactionPayload = (path: string, txInfo: BraveWallet.TransactionInfo, chainId: string): SignTransactionCommandPayload => {
    return {
      path: path,
      transaction: {
        to: txInfo.txData.baseData.to,
        value: txInfo.txData.baseData.value,
        data: bufferToHex(Buffer.from(txInfo.txData.baseData.data)).toString(),
        chainId: parseInt(chainId, 16),
        nonce: txInfo.txData.baseData.nonce,
        gasLimit: txInfo.txData.baseData.gasLimit,
        gasPrice: txInfo.txData.baseData.gasPrice
      }
    }
  }

  private readonly prepareSignMessagePayload = (path: string, message: string): SignMessageCommandPayload => {
    return { path: path, message: message }
  }

  private readonly publicKeyToAddress = (key: string) => {
    const buffer = Buffer.from(key, 'hex')
    const address = publicToAddress(buffer, true).toString('hex')
    return toChecksumAddress(`0x${address}`)
  }

  private readonly getAccountsFromDevice = async (paths: string[], skipZeroPath: boolean): Promise<GetAccountsHardwareOperationResult> => {
    const requestedPaths = []
    for (const path of paths) {
      requestedPaths.push({ path: path })
    }
    const data = await this.sendTrezorCommand<GetAccountsResponsePayload>({
      command: TrezorCommand.GetAccounts,
      id: TrezorCommand.GetAccounts,
      paths: requestedPaths,
      origin: window.origin
    })
    if (data === TrezorErrorsCodes.BridgeNotReady ||
        data === TrezorErrorsCodes.CommandInProgress) {
      return this.createErrorFromCode(data)
    }

    const response: TrezorGetAccountsResponse = data.payload
    if (!response.success) {
      const unsuccess = response.payload
      return { success: false, error: unsuccess.error, code: unsuccess.code }
    }

    let accounts = []
    const accountsList = response.payload as TrezorAccount[]
    this.deviceId = await this.getDeviceIdFromAccountsList(accountsList)
    const zeroPath = this.getPathForIndex(0, TrezorDerivationPaths.Default)
    for (const value of accountsList) {
      // If requested addresses do not have zero indexed adress we add it
      // intentionally to calculate device id and should not add it to
      // returned accounts
      if (skipZeroPath && (value.serializedPath === zeroPath)) {
        continue
      }
      accounts.push({
        address: this.publicKeyToAddress(value.publicKey),
        derivationPath: value.serializedPath,
        name: this.type(),
        hardwareVendor: this.type(),
        deviceId: this.deviceId,
        coin: this.coin()
      })
    }
    return { success: true, payload: [...accounts] }
  }

  private readonly createErrorFromCode = (code: TrezorErrorsCodes): HardwareOperationResult => {
    switch (code) {
      case TrezorErrorsCodes.BridgeNotReady:
        return { success: false, error: getLocale('braveWalletBridgeNotReady'), code: code }
      case TrezorErrorsCodes.CommandInProgress:
        return { success: false, error: getLocale('braveWalletBridgeCommandInProgress'), code: code }
    }
  }

  private readonly getPathForIndex = (index: number, scheme: string) => {
    if (scheme === TrezorDerivationPaths.Default) {
      return `m/44'/60'/0'/0/${index}`
    } else {
      throw Error(getLocale('braveWalletDeviceUnknownScheme'))
    }
  }
}
