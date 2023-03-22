#!/usr/bin/env node
import crypto from 'node:crypto'

import * as url from 'url'
import chalk from 'chalk'
import { cac } from 'cac'
import Conf from 'conf'
import { readPackageUp } from 'read-pkg-up'

import { ChatGPTAPI } from '../build/index.js'

const TOKEN_KEY = 'token'

async function main() {
  const dirname = url.fileURLToPath(new URL('.', import.meta.url))
  const pkg = await readPackageUp({ cwd: dirname })
  const version = (pkg && pkg.packageJson && pkg.packageJson.version) || '4'
  const config = new Conf({ projectName: 'sam' })

  const cli = cac('sam')
  cli
    .command('<prompt>', 'Ask Sam a question without quotes')
    .option('-c, --continue', 'Continue last conversation', {
      default: true
    })
    .option('-i, --instruct', 'Instruction to follow', {
      default: false
    })
    .option('-d, --debug', 'Enables debug logging', {
      default: false
    })
    .option('-s, --stream', 'Streams the response', {
      default: true
    })
    .option('-s, --store', 'Enables the local message cache', {
      default: true
    })
    .option('-t, --timeout', 'Timeout in milliseconds')
    // .option('-k, --apiKey <apiKey>', 'OpenAI API key')
    .option(
      '-n, --conversationName <conversationName>',
      'Unique name for the conversation'
    )
    .action(async (prompt, options) => {
      const apiKey = config.get(TOKEN_KEY) || process.env.OPENAI_API_KEY

      console.log(prompt, options)
      // const apiKey = "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"
      if (!apiKey) {
        console.error('error: either set OPENAI_API_KEY or use --apiKey\n')
        cli.outputHelp()
        process.exit(1)
      }

      const apiKeyHash = hash(apiKey)
      const conversationName = options.conversationName || 'default'
      const conversationKey = `${conversationName}:${apiKeyHash}`
      const conversation =
        options.continue && options.store
          ? config.get(conversationKey, {}) || {}
          : {}
      let conversationId = undefined
      let parentMessageId = undefined

      if (conversation.lastMessageId) {
        const lastMessage = conversation[conversation.lastMessageId]
        if (lastMessage) {
          conversationId = lastMessage.conversationId
          parentMessageId = lastMessage.id
        }
      }

      if (options.debug) {
        console.log('using config', config.path)
      }

      const api = new ChatGPTAPI({
        apiKey,
        debug: options.debug,
        getMessageById: async (id) => {
          if (options.store) {
            return conversation[id]
          } else {
            return null
          }
        },
        upsertMessage: async (message) => {
          if (options.store) {
            conversation[message.id] = message
            conversation.lastMessageId = message.id
            config.set(conversationKey, conversation)
          }
        }
      })

      const res = await api.sendMessage(`"${prompt}"`, {
        conversationId,
        parentMessageId,
        timeoutMs: options.timeout || undefined,
        onProgress: options.stream
          ? (progress) => {
              if (progress.delta) {
                process.stdout.write(progress.delta)
              }
            }
          : undefined
      })

      if (options.stream) {
        process.stdout.write('\n')
      } else {
        console.log(chalk.gray.bold(res.text))
      }
    })

  cli.command('rm-cache', 'Clears the local message cache').action(() => {
    config.clear()
    console.log('cleared cache', config.path)
  })

  cli.command('ls-cache', 'Prints the local message cache path').action(() => {
    console.log(config.path)
  })


  /* Configuration to set the openAI key into config */
  cli.command('setup', 'Setup cli config and keys')
  .option('-t, --token <token>', 'OpenAI API key')
  .action( async (options, setup) => {
    console.log({ setup, options})

    config.set(TOKEN_KEY, options.token)

    console.log(chalk.green('Token saved successfully'))
  })


  cli.help()
  cli.version(version)

  try {
    cli.parse()
  } catch (err) {
    console.error(`error: ${err.message}\n`)
    cli.outputHelp()
    process.exit(1)
  }
}

function hash(d) {
  const buffer = Buffer.isBuffer(d) ? d : Buffer.from(d.toString())
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
