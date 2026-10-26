import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import { Prisma, PrismaClient } from '@prisma/client'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const app = express()
const prisma = new PrismaClient()
const port = Number(process.env.PORT || 4000)
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-only-change-this-secret')
if (!jwtSecret) throw new Error('Set JWT_SECRET before starting in production.')
const demoAuthEnabled = process.env.DEMO_AUTH_ENABLED === 'true' && process.env.NODE_ENV !== 'production'
const demoAdminEmail = process.env.DEMO_ADMIN_EMAIL?.toLowerCase() || ''
const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD || ''

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '16mb' }))
app.use(cookieParser())
app.use('/api/auth', rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.setHeader('Retry-After', '300').status(429).json({ error: 'Too many authentication attempts. Please wait 5 minutes before trying again.' }),
}))
app.use('/api/donations', rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/contact', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }))

const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' }
const visitorChatCookieOptions = { ...cookieOptions, path: '/api/chat' }
type AuthRequest = Request & { auth?: { id: string; role: 'ADMIN' | 'FORMATOR' | 'USER'; demo?: boolean } }
function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.carmel_session as string | undefined
  if (!token) return res.status(401).json({ error: 'Sign in is required.' })
  try {
    const claims = jwt.verify(token, jwtSecret) as AuthRequest['auth']
    if (!claims?.id || !claims.role) return res.status(401).json({ error: 'Invalid session.' })
    req.auth = claims
    next()
  } catch { return res.status(401).json({ error: 'Your session has expired. Please sign in again.' }) }
}
function allowRoles(...roles: Array<'ADMIN' | 'FORMATOR' | 'USER'>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) return res.status(403).json({ error: 'You do not have access to this resource.' })
    next()
  }
}
function validate<T extends z.ZodType>(schema: T, input: unknown) {
  const result = schema.safeParse(input)
  return result.success ? { data: result.data, error: null } : { data: null, error: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }
}
async function audit(userId: string, action: string, entity: string, entityId: string, meta?: Prisma.InputJsonValue) {
  await prisma.auditLog.create({ data: { userId, action, entity, entityId, meta } })
}
const asyncRoute = (handler: (req: AuthRequest, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req as AuthRequest, res)).catch(next)
function routeParam(req: Request, name: string): string {
  const value = req.params[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'carmel-in-communion-api' }))

const memberPrivacyVersion = '2026-10-02'
const registerSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.email().transform((value) => value.toLowerCase()), phone: z.string().trim().min(7).max(30), address: z.string().trim().min(5).max(300), password: z.string().min(10).max(128), privacyConsent: z.literal(true) })
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const parsed = validate(registerSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please check the form fields.', details: parsed.error })
  const passwordHash = await bcrypt.hash(parsed.data!.password, 12)
  try {
    const user = await prisma.user.create({ data: { name: parsed.data!.name, email: parsed.data!.email, phone: parsed.data!.phone, address: parsed.data!.address, passwordHash, role: 'USER', privacyConsentAt: new Date(), privacyPolicyVersion: memberPrivacyVersion, discernment: { create: {} } }, select: { id: true, name: true, email: true, phone: true, address: true, role: true } })
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '8h' })
    res.cookie('carmel_session', token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 })
    res.status(201).json({ user })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'An account with this email already exists.' })
    throw error
  }
}))
const loginSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) })
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const parsed = validate(loginSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Enter a valid email and password.' })
  const input = parsed.data!
  const user = await prisma.user.findUnique({ where: { email: input.email } })
  if (user) {
    if (!user.isActive || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' })
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '8h' })
    res.cookie('carmel_session', token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 })
    return res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role, canManageUsers: user.canManageUsers, canManageDetails: user.canManageDetails, canManageUpdates: user.canManageUpdates } })
  }
  const providedPassword = Buffer.from(input.password)
  const expectedPassword = Buffer.from(demoAdminPassword)
  const passwordMatches = providedPassword.length === expectedPassword.length && timingSafeEqual(providedPassword, expectedPassword)
  if (demoAuthEnabled && demoAdminEmail && demoAdminPassword && input.email === demoAdminEmail && passwordMatches) {
    const user = { id: 'local-demo-admin', name: 'Local Demo Administrator', email: demoAdminEmail, role: 'ADMIN' as const }
    const token = jwt.sign({ id: user.id, role: user.role, demo: true }, jwtSecret, { expiresIn: '8h' })
    res.cookie('carmel_session', token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 })
    return res.json({ user })
  }
  return res.status(401).json({ error: 'Email or password is incorrect.' })
}))
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('carmel_session', cookieOptions); res.status(204).end() })
app.get('/api/auth/me', authenticate, asyncRoute(async (req, res) => {
  if (req.auth!.demo && demoAuthEnabled) {
    return res.json({ user: { id: req.auth!.id, name: 'Local Demo Administrator', email: demoAdminEmail, role: 'ADMIN', isActive: true } })
  }
  const user = await prisma.user.findUnique({ where: { id: req.auth!.id }, select: { id: true, name: true, email: true, phone: true, address: true, role: true, isActive: true, canManageUsers: true, canManageDetails: true, canManageUpdates: true } })
  if (!user?.isActive) return res.status(401).json({ error: 'This account is inactive.' })
  res.json({ user })
}))
const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(7).max(30).optional(),
  address: z.string().trim().min(5).max(300).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(10).max(128).optional(),
}).refine((input) => !input.newPassword || Boolean(input.currentPassword), { message: 'Enter your current password to set a new password.', path: ['currentPassword'] })
app.patch('/api/auth/me', authenticate, allowRoles('ADMIN', 'FORMATOR', 'USER'), asyncRoute(async (req, res) => {
  if (req.auth!.demo) return res.status(400).json({ error: 'Update this prototype account in its local profile editor.' })
  const parsed = validate(profileUpdateSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please check the profile fields.', details: parsed.error })
  const input = parsed.data!
  const currentUser = await prisma.user.findUnique({ where: { id: req.auth!.id }, select: { id: true, passwordHash: true, isActive: true } })
  if (!currentUser?.isActive) return res.status(401).json({ error: 'This account is inactive.' })
  if (input.newPassword && !(await bcrypt.compare(input.currentPassword!, currentUser.passwordHash))) return res.status(400).json({ error: 'Your current password is incorrect.' })
  const data: Prisma.UserUpdateInput = { name: input.name, email: input.email }
  if (input.phone !== undefined) data.phone = input.phone
  if (input.address !== undefined) data.address = input.address
  if (input.newPassword) data.passwordHash = await bcrypt.hash(input.newPassword, 12)
  try {
    const user = await prisma.user.update({ where: { id: currentUser.id }, data, select: { id: true, name: true, email: true, phone: true, address: true, role: true, isActive: true } })
    await audit(user.id, 'UPDATE_PROFILE', 'User', user.id)
    res.json({ user })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'An account with this email already exists.' })
    throw error
  }
}))

const donationSchema = z.object({
  amount: z.coerce.number().finite().min(50).max(10000000),
  frequency: z.enum(['ONE_TIME', 'MONTHLY']).default('ONE_TIME'),
  payment: z.enum(['GCASH', 'MAYA', 'BANK', 'CARD']),
  anonymous: z.boolean().default(true),
  name: z.string().trim().max(100).optional().default(''),
  email: z.union([z.email(), z.literal('')]).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  receipt: z.boolean().default(false),
  reference: z.string().trim().max(100).optional().default(''),
  fund: z.string().trim().max(150).optional().default('Federation formation program'),
})
app.post('/api/donations', asyncRoute(async (req, res) => {
  const parsed = validate(donationSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please check the donation details.', details: parsed.error })
  const input = parsed.data!
  if (!input.anonymous && (!input.name || !input.email)) return res.status(400).json({ error: 'Name and email are required for a named donation.' })
  if (input.receipt && !input.email && !input.phone) return res.status(400).json({ error: 'Add an email or phone number for the receipt.' })
  const referenceCode = `CARMEL-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
  const retainName = !input.anonymous
  const donation = await prisma.donation.create({ data: {
    referenceCode,
    amount: new Prisma.Decimal(input.amount),
    type: input.frequency,
    fund: input.fund,
    paymentMethod: input.payment,
    isAnonymous: input.anonymous,
    donorName: retainName ? input.name || null : null,
    donorEmail: retainName || input.receipt ? input.email || null : null,
    donorPhone: retainName || input.receipt ? input.phone || null : null,
    wantsReceipt: input.receipt,
    paymentReference: input.reference || null,
    status: input.reference ? 'RECONCILING' : 'PENDING',
  }, select: { referenceCode: true, amount: true, paymentMethod: true, isAnonymous: true, status: true, createdAt: true } })
  res.status(201).json({ donation })
}))
app.get('/api/donations/mine', authenticate, allowRoles('USER'), asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.id }, select: { email: true, isActive: true } })
  if (!user?.isActive) return res.status(401).json({ error: 'This account is inactive.' })
  const donations = await prisma.donation.findMany({ where: { donorEmail: user.email }, orderBy: { createdAt: 'desc' }, select: { referenceCode: true, amount: true, paymentMethod: true, status: true, createdAt: true, fund: true } })
  res.json({ donations })
}))
const discernmentStages = ['EXPLORING', 'PRAYING_AND_LEARNING', 'READY_TO_VISIT', 'IN_CONVERSATION'] as const
const discernmentSchema = z.object({ monastery: z.string().trim().max(150).default(''), note: z.string().trim().max(5000).default('') })
app.get('/api/discernment/mine', authenticate, allowRoles('USER'), asyncRoute(async (req, res) => {
  const discernment = await prisma.discernment.upsert({ where: { userId: req.auth!.id }, update: {}, create: { userId: req.auth!.id } })
  res.json({ discernment })
}))
app.patch('/api/discernment/mine', authenticate, allowRoles('USER'), asyncRoute(async (req, res) => {
  const parsed = validate(discernmentSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please check your discernment details.', details: parsed.error })
  const discernment = await prisma.discernment.upsert({ where: { userId: req.auth!.id }, update: parsed.data!, create: { userId: req.auth!.id, ...parsed.data! } })
  res.json({ discernment })
}))
app.get('/api/account/conversation', authenticate, allowRoles('USER'), asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.id }, select: { id: true, name: true, email: true, isActive: true } })
  if (!user?.isActive) return res.status(401).json({ error: 'This account is inactive.' })
  const conversation = await prisma.conversation.findUnique({
    where: { userId: user.id },
    include: { messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, name: true, role: true } } } } },
  })
  if (conversation) {
    await prisma.message.updateMany({ where: { conversationId: conversation.id, senderType: { in: ['ADMIN', 'FORMATOR'] }, readAt: null }, data: { readAt: new Date() } })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { isRead: true } })
  }
  res.json({ conversation })
}))
const memberMessageSchema = z.object({ body: z.string().trim().min(1).max(5000) })
app.post('/api/account/conversation/messages', authenticate, allowRoles('USER'), asyncRoute(async (req, res) => {
  const parsed = validate(memberMessageSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'A message cannot be empty.' })
  const user = await prisma.user.findUnique({ where: { id: req.auth!.id }, select: { id: true, name: true, email: true, isActive: true } })
  if (!user?.isActive) return res.status(401).json({ error: 'This account is inactive.' })
  const conversation = await prisma.$transaction(async (tx) => {
    const current = await tx.conversation.findUnique({ where: { userId: user.id }, select: { id: true } })
    const thread = current
      ? await tx.conversation.update({ where: { id: current.id }, data: { isRead: false, lastMessageAt: new Date() } })
      : await tx.conversation.create({ data: { userId: user.id, name: user.name, email: user.email, subject: 'Discernment conversation', category: 'DISCERNER', isRead: false } })
    await tx.message.create({ data: { conversationId: thread.id, senderId: user.id, senderType: 'VISITOR', body: parsed.data!.body } })
    return tx.conversation.findUniqueOrThrow({
      where: { id: thread.id },
      include: { messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, name: true, role: true } } } } },
    })
  })
  res.status(201).json({ conversation })
}))
app.get('/api/donations/:reference', asyncRoute(async (req, res) => {
  const donation = await prisma.donation.findUnique({ where: { referenceCode: routeParam(req, 'reference') }, select: { referenceCode: true, amount: true, paymentMethod: true, isAnonymous: true, status: true, createdAt: true, fund: true } })
  if (!donation) return res.status(404).json({ error: 'Acknowledgment not found.' })
  res.json({ donation })
}))

const contactSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.email(), subject: z.string().trim().min(3).max(160), category: z.enum(['DONATION', 'DISCERNER', 'GENERAL']).default('GENERAL'), message: z.string().trim().min(10).max(5000) })
app.post('/api/contact', asyncRoute(async (req, res) => {
  const parsed = validate(contactSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please check the message form.', details: parsed.error })
  const input = parsed.data!
  const conversation = await prisma.conversation.create({ data: { name: input.name, email: input.email, subject: input.subject, category: input.category, messages: { create: { senderType: 'VISITOR', body: input.message } } }, select: { id: true, createdAt: true } })
  res.status(201).json({ conversationId: conversation.id, received: true })
}))
const publicChatStartSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  body: z.string().trim().min(1).max(5000),
})
function visitorChatId(req: Request): string | null {
  const token = req.cookies?.carmel_chat_session as string | undefined
  if (!token) return null
  try {
    const claims = jwt.verify(token, jwtSecret)
    if (typeof claims === 'string' || claims.purpose !== 'visitor-chat' || typeof claims.conversationId !== 'string') return null
    return claims.conversationId
  } catch {
    return null
  }
}
app.post('/api/chat/conversations', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }), asyncRoute(async (req, res) => {
  const parsed = validate(publicChatStartSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Enter your name, a valid email, and a message.' })
  const conversation = await prisma.conversation.create({
    data: {
      name: parsed.data!.name,
      email: parsed.data!.email,
      subject: 'Website chat',
      category: 'GENERAL',
      messages: { create: { senderType: 'VISITOR', body: parsed.data!.body } },
    },
    include: { messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, name: true, role: true } } } } },
  })
  const token = jwt.sign({ purpose: 'visitor-chat', conversationId: conversation.id }, jwtSecret, { expiresIn: '30d' })
  res.cookie('carmel_chat_session', token, { ...visitorChatCookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 })
  res.status(201).json({ conversation, unreadCount: 0 })
}))
app.get('/api/chat/conversation', asyncRoute(async (req, res) => {
  const conversationId = visitorChatId(req)
  if (!conversationId) {
    res.clearCookie('carmel_chat_session', visitorChatCookieOptions)
    return res.json({ conversation: null, unreadCount: 0 })
  }
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, name: true, role: true } } } } },
  })
  if (!conversation) {
    res.clearCookie('carmel_chat_session', visitorChatCookieOptions)
    return res.json({ conversation: null, unreadCount: 0 })
  }
  const unreadCount = conversation.messages.filter((message) => message.senderType !== 'VISITOR' && !message.readAt).length
  res.json({ conversation, unreadCount })
}))
app.post('/api/chat/conversation/read', asyncRoute(async (req, res) => {
  const conversationId = visitorChatId(req)
  if (!conversationId) return res.status(401).json({ error: 'Start a conversation to continue chatting.' })
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } })
  if (!conversation) return res.status(404).json({ error: 'This conversation is no longer available.' })
  await prisma.$transaction([
    prisma.message.updateMany({ where: { conversationId, senderType: { in: ['ADMIN', 'FORMATOR'] }, readAt: null }, data: { readAt: new Date() } }),
    prisma.conversation.update({ where: { id: conversationId }, data: { isRead: true } }),
  ])
  res.status(204).end()
}))
app.post('/api/chat/messages', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }), asyncRoute(async (req, res) => {
  const conversationId = visitorChatId(req)
  if (!conversationId) return res.status(401).json({ error: 'Start a conversation to continue chatting.' })
  const parsed = validate(memberMessageSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'A message cannot be empty.' })
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } })
  if (!conversation) return res.status(404).json({ error: 'This conversation is no longer available.' })
  const updated = await prisma.$transaction(async (tx) => {
    await tx.message.create({ data: { conversationId, senderType: 'VISITOR', body: parsed.data!.body } })
    await tx.conversation.update({ where: { id: conversationId }, data: { isRead: false, lastMessageAt: new Date() } })
    return tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, name: true, role: true } } } } },
    })
  })
  res.status(201).json({ conversation: updated, unreadCount: 0 })
}))

app.get('/api/monasteries', asyncRoute(async (_req, res) => {
  const monasteries = await prisma.monastery.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
  res.json({ monasteries })
}))
app.get('/api/updates', asyncRoute(async (_req, res) => {
  const updates = await prisma.update.findMany({ where: { publishedAt: { lte: new Date() } }, orderBy: { publishedAt: 'desc' } })
  res.json({ updates })
}))
app.get('/api/content/:pageKey', asyncRoute(async (req, res) => {
  const content = await prisma.pageContent.findUnique({ where: { pageKey: routeParam(req, 'pageKey').toUpperCase() } })
  if (!content) return res.status(404).json({ error: 'Page content not found.' })
  res.json({ content })
}))
const managedMonasterySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  description: z.string().max(5000),
  projectTitle: z.string().max(200),
  projectDetails: z.string().max(5000),
  image: z.string().max(3_000_000),
})
const managedArticleSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  author: z.string().max(200),
  body: z.string().max(100_000),
  image: z.string().max(3_000_000),
})
const managedSiteContentSchema = z.object({
  homeHeroImage: z.string().max(3_000_000),
  monasteries: z.array(managedMonasterySchema).max(100),
  carmelife: z.array(managedArticleSchema).max(200),
  carmelights: z.array(managedArticleSchema).max(200),
})
const managedUpdatesSchema = z.array(z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  date: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  image: z.string().max(3_000_000),
  body: z.string().max(100_000),
})).max(500)
app.put('/api/admin/content/:pageKey', authenticate, allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const pageKey = routeParam(req, 'pageKey').toUpperCase()
  if (pageKey !== 'SITE_MANAGED' && pageKey !== 'SITE_UPDATES') return res.status(404).json({ error: 'Editable content section not found.' })
  const parsed = pageKey === 'SITE_MANAGED'
    ? validate(z.object({ blocks: managedSiteContentSchema }), req.body)
    : validate(z.object({ blocks: managedUpdatesSchema }), req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please check the website content before saving.', details: parsed.error })
  const content = await prisma.pageContent.upsert({
    where: { pageKey },
    update: { blocks: parsed.data!.blocks as Prisma.InputJsonValue },
    create: { pageKey, blocks: parsed.data!.blocks as Prisma.InputJsonValue },
  })
  await audit(req.auth!.id, 'UPDATE_CONTENT', 'PageContent', content.id, { pageKey })
  res.json({ content })
}))
const homeHeroImageSchema = z.object({ image: z.string().trim().min(1).max(3_000_000) })
app.put('/api/admin/content/home-hero-image', authenticate, allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const parsed = validate(homeHeroImageSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Provide a valid homepage image.' })
  const content = await prisma.pageContent.upsert({
    where: { pageKey: 'HOME_HERO_IMAGE' },
    update: { blocks: { image: parsed.data!.image } },
    create: { pageKey: 'HOME_HERO_IMAGE', blocks: { image: parsed.data!.image } },
  })
  await audit(req.auth!.id, 'UPDATE_CONTENT', 'PageContent', content.id, { pageKey: 'HOME_HERO_IMAGE' })
  res.json({ content })
}))
app.get('/api/faqs', asyncRoute(async (_req, res) => {
  const faqs = await prisma.fAQ.findMany({ where: { isPublished: true }, orderBy: { sortOrder: 'asc' } })
  res.json({ faqs })
}))

app.get('/api/admin/donations', authenticate, allowRoles('ADMIN', 'FORMATOR'), asyncRoute(async (_req, res) => {
  const donations = await prisma.donation.findMany({ orderBy: { createdAt: 'desc' }, include: { beneficiaryMonastery: { select: { name: true } } } })
  res.json({ donations })
}))
const managedUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  role: true,
  isActive: true,
  canManageUsers: true,
  canManageDetails: true,
  canManageUpdates: true,
  createdAt: true,
  discernment: { select: { stage: true, monastery: true, updatedAt: true } },
} as const
async function authorizeManagedAccounts(req: AuthRequest, res: Response, allowFormator: boolean) {
  if (!req.auth || req.auth.demo) {
    res.status(403).json({ error: 'A database-backed staff account is required to manage accounts.' })
    return null
  }
  const user = await prisma.user.findUnique({
    where: { id: req.auth.id },
    select: { id: true, role: true, isActive: true, canManageUsers: true },
  })
  if (!user?.isActive || (user.role !== 'ADMIN' && !(allowFormator && user.role === 'FORMATOR' && user.canManageUsers))) {
    res.status(403).json({ error: 'You do not have access to manage these accounts.' })
    return null
  }
  return user
}
app.get('/api/admin/users', authenticate, asyncRoute(async (req, res) => {
  const actor = await authorizeManagedAccounts(req, res, true)
  if (!actor) return
  const requestedRole = typeof req.query.role === 'string' ? req.query.role.toUpperCase() : 'ALL'
  if (!['ALL', 'USER', 'FORMATOR'].includes(requestedRole)) return res.status(400).json({ error: 'Choose a valid account type.' })
  if (actor.role !== 'ADMIN' && requestedRole !== 'USER') return res.status(403).json({ error: 'Formators can only view community user accounts.' })
  const roles = requestedRole === 'ALL' ? ['USER', 'FORMATOR'] as const : [requestedRole as 'USER' | 'FORMATOR']
  const [users, userCount, formatorCount] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: [...roles] } }, orderBy: [{ createdAt: 'desc' }, { name: 'asc' }], select: managedUserSelect }),
    prisma.user.count({ where: { role: 'USER' } }),
    actor.role === 'ADMIN' ? prisma.user.count({ where: { role: 'FORMATOR' } }) : Promise.resolve(0),
  ])
  res.json({ users, counts: { USER: userCount, FORMATOR: formatorCount } })
}))
const createFormatorSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
  canManageUsers: z.boolean().default(false),
  canManageDetails: z.boolean().default(false),
  canManageUpdates: z.boolean().default(false),
})
app.post('/api/admin/users/formators', authenticate, allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const actor = await authorizeManagedAccounts(req, res, false)
  if (!actor) return
  const parsed = validate(createFormatorSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please check the Formator account details.', details: parsed.error })
  const input = parsed.data!
  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        role: 'FORMATOR',
        canManageUsers: input.canManageUsers,
        canManageDetails: input.canManageDetails,
        canManageUpdates: input.canManageUpdates,
      },
      select: managedUserSelect,
    })
    await audit(actor.id, 'CREATE', 'User', user.id, { role: user.role })
    res.status(201).json({ user })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'An account with this email already exists.' })
    throw error
  }
}))
const managedAccountUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  canManageUsers: z.boolean().optional(),
  canManageDetails: z.boolean().optional(),
  canManageUpdates: z.boolean().optional(),
}).refine((input) => Object.keys(input).length > 0, { message: 'Choose an account setting to update.' })
app.patch('/api/admin/users/:id', authenticate, asyncRoute(async (req, res) => {
  const actor = await authorizeManagedAccounts(req, res, true)
  if (!actor) return
  const parsed = validate(managedAccountUpdateSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Please provide a valid account update.', details: parsed.error })
  const id = routeParam(req, 'id')
  if (id === actor.id && parsed.data!.isActive === false) return res.status(400).json({ error: 'You cannot disable your own account.' })
  const current = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!current || current.role === 'ADMIN') return res.status(404).json({ error: 'Managed account not found.' })
  if (actor.role === 'FORMATOR' && (current.role !== 'USER' || Object.keys(parsed.data!).some((key) => key !== 'isActive'))) {
    return res.status(403).json({ error: 'Formators can only change community user account status.' })
  }
  const user = await prisma.user.update({ where: { id }, data: parsed.data!, select: managedUserSelect })
  await audit(actor.id, 'UPDATE', 'User', user.id, parsed.data! as Prisma.InputJsonValue)
  res.json({ user })
}))
app.delete('/api/admin/users/:id', authenticate, allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const actor = await authorizeManagedAccounts(req, res, false)
  if (!actor) return
  const id = routeParam(req, 'id')
  if (id === actor.id) return res.status(400).json({ error: 'You cannot delete your own account.' })
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, name: true } })
  if (!user || user.role === 'ADMIN') return res.status(404).json({ error: 'Managed account not found.' })
  await prisma.user.delete({ where: { id } })
  await audit(actor.id, 'DELETE', 'User', user.id, { name: user.name, role: user.role })
  res.status(204).end()
}))
app.get('/api/admin/discernment', authenticate, allowRoles('ADMIN'), asyncRoute(async (_req, res) => {
  const members = await prisma.user.findMany({ where: { role: 'USER', isActive: true }, select: { id: true } })
  if (members.length) {
    await prisma.discernment.createMany({ data: members.map(({ id }) => ({ userId: id })), skipDuplicates: true })
  }
  const discerners = await prisma.discernment.findMany({ where: { user: { isActive: true } }, orderBy: { updatedAt: 'desc' }, select: { id: true, userId: true, stage: true, monastery: true, updatedAt: true, user: { select: { name: true, email: true } } } })
  res.json({ discerners })
}))
const discernmentStageSchema = z.object({ stage: z.enum(discernmentStages) })
app.patch('/api/admin/discernment/:userId/stage', authenticate, allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const parsed = validate(discernmentStageSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Choose a valid discernment stage.' })
  const userId = routeParam(req, 'userId')
  const current = await prisma.discernment.findUnique({ where: { userId }, select: { stage: true } })
  if (!current) return res.status(404).json({ error: 'Discernment record not found.' })
  const discernment = await prisma.discernment.update({ where: { userId }, data: { stage: parsed.data!.stage }, select: { userId: true, stage: true, updatedAt: true } })
  await audit(req.auth!.id, 'UPDATE_STAGE', 'Discernment', discernment.userId, { from: current.stage, to: discernment.stage })
  res.json({ discernment })
}))
const statusSchema = z.object({ status: z.enum(['PENDING', 'RECONCILING', 'VERIFIED', 'COMPLETED', 'FAILED']) })
app.patch('/api/admin/donations/:id/status', authenticate, allowRoles('ADMIN', 'FORMATOR'), asyncRoute(async (req, res) => {
  const parsed = validate(statusSchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'Invalid donation status.' })
  const donationId = routeParam(req, 'id')
  const previous = await prisma.donation.findUnique({ where: { id: donationId }, select: { status: true } })
  if (!previous) return res.status(404).json({ error: 'Donation not found.' })
  const donation = await prisma.donation.update({ where: { id: donationId }, data: { status: parsed.data!.status } })
  await audit(req.auth!.id, 'UPDATE_STATUS', 'Donation', donation.id, { from: previous.status, to: donation.status })
  res.json({ donation })
}))
app.get('/api/admin/conversations', authenticate, allowRoles('ADMIN', 'FORMATOR'), asyncRoute(async (_req, res) => {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    include: {
      user: { select: { id: true, role: true, isActive: true } },
      messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, name: true, role: true } } } },
    },
  })
  res.json({ conversations })
}))
app.get('/api/admin/notifications', authenticate, allowRoles('ADMIN', 'FORMATOR'), asyncRoute(async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const isAdmin = req.auth!.role === 'ADMIN'
  const [staffPermissions, unreadMessageCount, recentMessages, recentUsers, recentDonations, recentAuditLogs, recentUpdates, recentContent] = await Promise.all([
    isAdmin ? Promise.resolve(null) : prisma.user.findUnique({ where: { id: req.auth!.id }, select: { canManageUsers: true, canManageDetails: true, canManageUpdates: true } }),
    prisma.message.count({ where: { senderType: 'VISITOR', readAt: null } }),
    prisma.message.findMany({
      where: { senderType: 'VISITOR', OR: [{ readAt: null }, { createdAt: { gte: since } }] },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { conversation: { select: { id: true, name: true, subject: true } } },
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: since }, role: { in: ['USER', 'FORMATOR'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, name: true, role: true, createdAt: true },
    }),
    prisma.donation.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, donorName: true, fund: true, status: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: since }, entity: { not: 'PageContent' } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, action: true, entity: true, entityId: true, createdAt: true },
    }),
    prisma.update.findMany({
      where: { updatedAt: { gte: since }, publishedAt: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, title: true, updatedAt: true },
    }),
    prisma.pageContent.findMany({
      where: { updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, pageKey: true, updatedAt: true },
    }),
  ])
  const canManageUsers = isAdmin || staffPermissions?.canManageUsers === true
  const canManageDetails = isAdmin || staffPermissions?.canManageDetails === true
  const canManageUpdates = isAdmin || staffPermissions?.canManageUpdates === true
  const notifications = [
    ...recentMessages.map((message) => ({
      id: `message-${message.id}`,
      kind: 'message',
      title: `Message from ${message.conversation.name}`,
      description: message.conversation.subject,
      createdAt: message.createdAt,
      href: `/admin/messages?conversation=${encodeURIComponent(message.conversation.id)}`,
      unread: message.readAt === null,
    })),
    ...recentUsers.map((user) => ({
      id: `user-${user.id}`,
      kind: 'account',
      title: user.role === 'USER' ? 'New discerner account' : 'New Formator account',
      description: user.name,
      createdAt: user.createdAt,
      href: canManageUsers ? `/admin/users?role=${user.role}` : '/admin/messages',
      unread: false,
    })),
    ...recentDonations.map((donation) => ({
      id: `donation-${donation.id}`,
      kind: 'donation',
      title: 'New donation received',
      description: `${donation.donorName || 'Anonymous'} · ${donation.fund} · ${donation.status}`,
      createdAt: donation.createdAt,
      href: isAdmin ? '/admin/donations' : '/admin/messages',
      unread: false,
    })),
    ...recentAuditLogs.map((log) => ({
      id: `audit-${log.id}`,
      kind: 'activity',
      title: `${log.action.replaceAll('_', ' ')} · ${log.entity}`,
      description: 'A dashboard record was updated.',
      createdAt: log.createdAt,
      href: log.entity === 'Conversation' ? '/admin/messages' : log.entity === 'Donation' && isAdmin ? '/admin/donations' : log.entity === 'User' && canManageUsers ? '/admin/users?role=USER' : '/admin',
      unread: false,
    })),
    ...recentUpdates.map((update) => ({
      id: `update-${update.id}`,
      kind: 'update',
      title: 'Website update published',
      description: update.title,
      createdAt: update.updatedAt,
      href: canManageUpdates ? '/admin/updates' : '/admin',
      unread: false,
    })),
    ...recentContent.map((content) => ({
      id: `content-${content.id}`,
      kind: 'content',
      title: 'Website content updated',
      description: content.pageKey.replaceAll('_', ' ').toLowerCase(),
      createdAt: content.updatedAt,
      href: canManageDetails ? '/admin/content' : '/admin',
      unread: false,
    })),
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 30)
  res.json({ unreadMessageCount, notifications })
}))
app.post('/api/admin/conversations/:id/read', authenticate, allowRoles('ADMIN', 'FORMATOR'), asyncRoute(async (req, res) => {
  const id = routeParam(req, 'id')
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true } })
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' })
  await prisma.$transaction([
    prisma.message.updateMany({ where: { conversationId: id, senderType: 'VISITOR', readAt: null }, data: { readAt: new Date() } }),
    prisma.conversation.update({ where: { id }, data: { isRead: true } }),
  ])
  res.status(204).end()
}))
const replySchema = z.object({ body: z.string().trim().min(1).max(5000) })
app.post('/api/admin/conversations/:id/messages', authenticate, allowRoles('ADMIN', 'FORMATOR'), asyncRoute(async (req, res) => {
  const parsed = validate(replySchema, req.body)
  if (parsed.error) return res.status(400).json({ error: 'A reply cannot be empty.' })
  const conversation = await prisma.conversation.findUnique({ where: { id: routeParam(req, 'id') }, select: { id: true, userId: true } })
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' })
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({ data: { conversationId: conversation.id, senderId: req.auth!.id, senderType: req.auth!.role === 'FORMATOR' ? 'FORMATOR' : 'ADMIN', body: parsed.data!.body } })
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), isRead: true } })
    await tx.auditLog.create({ data: { userId: req.auth!.id, action: 'REPLY', entity: 'Conversation', entityId: conversation.id } })
    return created
  })
  res.status(201).json({ message })
}))
app.get('/api/admin/audit', authenticate, allowRoles('ADMIN'), asyncRoute(async (_req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { user: { select: { name: true, email: true } } } })
  res.json({ logs })
}))

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(500).json({ error: 'The request could not be completed. Please try again.' })
})
const server = app.listen(port, () => console.log(`Carmel API listening on http://localhost:${port}`))
async function shutdown() { server.close(); await prisma.$disconnect() }
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
