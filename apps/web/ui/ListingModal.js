import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { AddressZero } from '@ethersproject/constants'
import { Contract } from '@ethersproject/contracts'
import { randomBytes } from '@ethersproject/random'
import { parseEther } from '@ethersproject/units'
import { Builders, Helpers } from '@georgeroman/wyvern-v2-sdk'
import { Dialog, Transition } from '@headlessui/react'
import { XIcon } from '@heroicons/react/solid'
import axios from 'axios'
import React, { Fragment, useEffect, useState } from 'react'
import { HiCheck, HiX } from 'react-icons/hi'

export default function ListingModal({ signer, collection, tokenId }) {
  let [isOpen, setIsOpen] = useState(false)

  let initStep = {
    pending: null,
    success: null,
    error: null,
    tx: null,
  }

  // Steps:
  // 1. user proxy registration/checking
  // 2. approval setting/checking
  // 3. order signing

  // For steps:
  // null = undetermined
  // true = success
  // false = error/rejection from user
  // tx = link to the pending transaction
  let [step1, setStep1] = useState(initStep)
  let [step2, setStep2] = useState(initStep)
  let [step3, setStep3] = useState(initStep)

  // Sorry for the `any` :)
  let [collectionContract, setCollectionContract] = useState()
  let [proxyRegistryContract, setProxyRegistryContract] = useState()
  let [signerAddress, setSignerAddress] = useState()
  let [userProxy, setUserProxy] = useState()

  let [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const execute = async () => {
      setSignerAddress(await signer.getAddress())

      const collectionContract = new Contract(
        collection,
        new Interface([
          'function ownerOf(uint256 tokenId) view returns (address)',
          'function getApproved(uint256 tokenId) view returns (address)',
          'function isApprovedForAll(address owner, address operator) view returns (bool)',
          'function setApprovalForAll(address operator, bool approved)',
        ])
      )
      setCollectionContract(collectionContract)

      const proxyRegistryContract = new Contract(
        // TODO: Dynamically select address based on current network
        // (eg. mainnet address = "0xa5409ec958c83c3f309868babaca7c86dcb077c1")
        '0xf57b2c51ded3a29e6891aba85459d600256cf317',
        new Interface([
          'function proxies(address) view returns (address)',
          'function registerProxy()',
        ])
      )
      setProxyRegistryContract(proxyRegistryContract)
    }

    execute().then(() => setInitialized(true))
  }, [])

  // Step 1 - user proxy registration/checking
  useEffect(() => {
    async function executeStep1() {
      setStep1({
        ...step1,
        pending: true,
      })

      try {
        // Make sure the connected account is the owner of the listed token
        const owner = await collectionContract.connect(signer).ownerOf(tokenId)
        if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
          // Set error
          setStep1({
            pending: false,
            success: false,
            error: 'Current user is not the owner of the listed token',
            tx: null,
          })

          // Exit
          return
        }

        // Retrieve user proxy
        let userProxy = await proxyRegistryContract
          .connect(signer)
          .proxies(await signer.getAddress())

        if (userProxy === AddressZero) {
          // If the user has no associated proxy, then register one
          await proxyRegistryContract
            .connect(signer)
            .registerProxy()
            // Wait for the transaction to get mined
            .then((tx) => {
              setStep1({
                ...step1,
                tx: `https://rinkeby.etherscan.io/tx/${tx.hash}`,
              })
              tx.wait().then(() =>
                proxyRegistryContract
                  .connect(signer)
                  .proxies(signerAddress)
                  .then((userProxy) => {
                    // Set user proxy
                    setUserProxy(userProxy)

                    // Set success
                    setStep1({
                      pending: false,
                      success: true,
                      error: null,
                      // TODO: Dynamically select explorer link based on current network
                      tx: `https://rinkeby.etherscan.io/tx/${tx.hash}`,
                    })
                  })
              )
            })
        } else {
          // The user already registered a proxy

          // Set user proxy
          setUserProxy(userProxy)

          // Set success
          setStep1({
            pending: false,
            success: true,
            error: null,
            tx: null,
          })
        }
      } catch (error) {
        console.error('Step 1', error)

        // Set error
        setStep1({
          pending: false,
          error: 'Could not check/register user proxy',
          success: false,
          tx: null,
        })
      }
    }

    if (initialized && isOpen) {
      if (!step1.success) {
        executeStep1()
      }
    }
  }, [initialized, isOpen])

  // Step 2 - approval setting/checking
  useEffect(() => {
    async function executeStep2() {
      setStep2({
        ...step2,
        pending: true,
      })

      try {
        // Check approval on the user proxy
        let isApproved = await collectionContract
          .connect(signer)
          .isApprovedForAll(signerAddress, userProxy)
        if (!isApproved) {
          const approved = await collectionContract
            .connect(signer)
            .getApproved(tokenId)
          isApproved = approved.toLowerCase() === signerAddress.toLowerCase()
        }

        if (isApproved) {
          // Set success
          setStep2({
            pending: false,
            success: true,
            error: null,
            tx: null,
          })
        } else {
          // Set the approval on the user proxy
          await collectionContract
            .connect(signer)
            .setApprovalForAll(userProxy, true)
            // Wait for the transaction to get mined
            .then(({ wait, hash }) => {
              setStep2({
                ...step2,
                // TODO: Dynamically select explorer link based on current network
                tx: `https://rinkeby.etherscan.io/tx/${hash}`,
              })
              wait().then(() => {
                // Set success
                setStep2({
                  pending: false,
                  success: true,
                  error: null,
                  tx: `https://rinkeby.etherscan.io/tx/${hash}`,
                })
              })
            })
        }
      } catch (error) {
        console.error('Step 2', error)

        // Set error
        setStep2({
          error: 'Could not check/set approval',
          success: false,
          tx: null,
          pending: false,
        })
      }
    }

    if (step1.success) {
      executeStep2()
    }
  }, [step1])

  useEffect(() => {
    async function executeStep3() {
      setStep3({
        ...step3,
        pending: true,
      })
      try {
        // Build and sign the sell order
        let sellOrder = Builders.Erc721.SingleItem.sell({
          // TODO: Dynamically select exchange address based on current network
          // (eg. mainnet address = "0x7be8076f4ea4a4ad08075c2508e481d6c946d12b")
          exchange: '0x5206e78b21ce315ce284fb24cf05e0585a93b1d9',
          maker: signerAddress,
          target: collection,
          tokenId: tokenId,
          paymentToken: AddressZero,
          // TODO: Dynamically set price
          basePrice: parseEther('0.01'),
          // TODO: Dynamically (or not) set fee
          fee: 0,
          // The fee recipient on the maker's order should never be the zero address.
          // Even if the fee is 0, the fee recipient should be set to the maker's address.
          feeRecipient: signerAddress,
          // Set listing time 2 minutes in the past to make sure on-chain validation passes
          listingTime: Math.floor(Date.now() / 1000) - 120,
          // TODO: Dynamically set expiration time
          expirationTime: 0,
          salt: BigNumber.from(randomBytes(32)),
        })
        sellOrder = await Helpers.Order.sign(signer, sellOrder)

        await axios.post('https://api.rinkeby.loot.exchange/orders', {
          orders: [sellOrder],
        })

        // Set success
        setStep3({
          pending: false,
          success: true,
          error: null,
          tx: null,
        })
      } catch (error) {
        console.error('Step 3', error)

        // Set error
        setStep3({
          pending: false,
          error: 'Could not build/sign the sell order',
          success: false,
          tx: null,
        })
      }
    }
    if (step2.success) {
      executeStep3()
    }
  }, [step2])

  function closeModal() {
    setIsOpen(false)
  }

  function openModal() {
    setIsOpen(true)
  }

  return (
    <>
      <div onClick={openModal}>
        List on Loot Exchange
      </div>

      <Transition appear onClick={openModal} show={isOpen} as={Fragment}>
        <Dialog as="div" onClose={closeModal}>
          <div>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Dialog.Overlay />
            </Transition.Child>

            {/* This element is to trick the browser into centering the modal contents. */}
            <span aria-hidden="true">&#8203;</span>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <div>
                <Dialog.Title as="h3">
                  <p>Complete your listing</p>
                  <button type="button" onClick={closeModal}>
                    <XIcon />
                  </button>
                </Dialog.Title>
                <div>
                  <Step
                    stepNumber={1}
                    stepData={step1}
                    title="Initialize your wallet"
                  >
                    To get set up for selling on Loot Exchange for the first
                    time, you must initialize your wallet, which requires a
                    one-time gas fee.
                  </Step>
                  <Step stepNumber={2} stepData={step2} title="Approve token">
                    To get set up for auction listings for the first time, you
                    must approve the token for trading, which requires a
                    one-time gas fee.
                  </Step>
                  <Step stepNumber={3} stepData={step3} title="Confirm listing">
                    Accept the signature request in your wallet and wait for
                    your listing to process.
                  </Step>
                </div>
              </div>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}

const Step = ({ stepData, stepNumber, title, children }) => {
  const { error, pending, success, tx } = stepData
  return (
    <>
      <div>
        {!!pending ? (
          <Spinner />
        ) : (
          <>
            {!!success ? <HiCheck /> : !!error ? <HiX /> : <p>{stepNumber}</p>}
          </>
        )}
        <span>{title}</span>
      </div>
      <div>
        {!success && (
          <>
            <p>{children}</p>
            {!!pending && !!tx && <a href={tx}>See transaction.</a>}
            {!!error && <ErrorMessage error={error} />}
          </>
        )}
      </div>
    </>
  )
}

const ErrorMessage = ({ error }) => <p>{error}</p>

const Spinner = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
)