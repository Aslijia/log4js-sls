import { assign, chunk } from 'lodash'
import moment from 'moment'

const aliyun = require('aliyun-sdk')
declare interface Options {
    access: string
    secret: string
    endpoint: string
    version: string
    timeout?: number
    project: string
    storage: string
    batch?: number
    interval?: number
    topic?: string
    content?: any
}

declare interface LogContent {
    startTime: Date
    categoryName: string
    data: [string, any]
    level: {
        level: number
        levelStr: string
    }
    pid: number
}

class Uploader {
    slsclient: any
    config: any
    interval: NodeJS.Timeout | undefined
    caches: any[] = []
    upload(content: LogContent) {
        if (!this.slsclient || !this.config) {
            return
        }

        const logbody = content.data[1]
        if (typeof logbody !== 'object') {
            return
        }

        logbody._message = content.data[0]
        logbody._category = content.categoryName
        logbody._level = content.level.levelStr
        logbody._timestamp = content.startTime
        this.config.content && assign(logbody, this.config.content)

        const contents = []
        for (let i in logbody) {
            if (logbody[i] !== null && logbody[i] !== undefined) {
                try {
                    contents.push({ key: i, value: typeof logbody[i] === 'object' ? JSON.stringify(logbody[i]) : logbody[i].toString() })
                } catch (_) {
                    contents.push({ key: i, value: 'circular object' })
                }
            }
        }
        if (this.config.interval) {
            this.caches.push({
                time: moment(content.startTime).unix(),
                contents
            })

            if (!this.interval) {
                const batch = this.config.batch || 20
                this.interval = setInterval(() => {
                    if (this.caches.length) {
                        const batches = chunk(this.caches, batch)
                        this.caches = []
                        batches.forEach((item) => {
                            this.sendbatch(item)
                        })
                    }
                }, this.config.interval)
            }
            return
        }
        this.sendbatch([
            {
                time: moment(content.startTime).unix(),
                contents
            }
        ])
    }

    sendbatch(logs: any[]) {
        if (!this.config || !this.slsclient.putLogs || !logs.length) return

        try {
            this.slsclient.putLogs(
                {
                    projectName: this.config.project,
                    logStoreName: this.config.storage,
                    logGroup: {
                        logs,
                        topic: this.config.topic
                    }
                },
                (err: Error) => {
                    if (err) {
                        console.error('send log failed: ', err.message)
                    }
                }
            )
        } catch (_) {}
    }
}

export function configure(opts: Options) {
    if (!opts.access || !opts.project || !opts.secret || !opts.endpoint || !opts.storage) {
        throw new Error('missing required params')
    }
    const uploader = new Uploader()
    uploader.config = opts

    const params: any = {
        accessKeyId: opts.access,
        secretAccessKey: opts.secret,
        endpoint: opts.endpoint,
        apiVersion: opts.version
    }

    if (opts.timeout) {
        params.httpOptions = {
            timeout: opts.timeout
        }
    }
    uploader.slsclient = new aliyun.SLS(params)
    process.once('beforeExit', () => {
        if (!uploader.caches.length) return
        uploader.sendbatch(uploader.caches)
    })
    return uploader.upload.bind(uploader)
}
