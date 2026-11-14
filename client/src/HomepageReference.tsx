import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { homeSectionCards, type HomeSectionKey } from './home-section-cards'
import './homepage-reference.css'

const cities = ['Angeles', 'Bacolod', 'Baguio', 'Cagayan de Oro', 'Castillejos', 'Cebu', 'Davao', 'Gumaca', 'Infanta']
const heroImageCacheKey = 'carmel-home-hero-image-v2'
const heroImageFallback = '/assets/images/home-hero.jpg'
const maxInlineHeroImageLength = 350_000

function isLocalPreviewSession() {
  try {
    const staff = JSON.parse(localStorage.getItem('carmel-prototype-session') || 'null') as { demo?: boolean } | null
    const member = JSON.parse(localStorage.getItem('carmel-member-session') || 'null') as { demo?: boolean } | null
    return staff?.demo === true || member?.demo === true
  } catch {
    return false
  }
}

function getCachedHeroImage() {
  try {
    return localStorage.getItem(heroImageCacheKey) || heroImageFallback
  } catch (error) {
    console.error('Unable to read the cached homepage image.', error)
    return heroImageFallback
  }
}

function cacheHeroImage(image: string | null) {
  try {
    if (image && image.length <= maxInlineHeroImageLength) localStorage.setItem(heroImageCacheKey, image)
    else localStorage.removeItem(heroImageCacheKey)
  } catch (error) {
    console.error('Unable to cache the homepage image.', error)
  }
}

export default function HomepageReference() {
  const cards = useRef<HTMLDivElement>(null)
  const [heroImage, setHeroImage] = useState(getCachedHeroImage)
  const [sectionImages, setSectionImages] = useState<Partial<Record<HomeSectionKey, string>>>(() => {
    try {
      return JSON.parse(localStorage.getItem('carmel-home-section-images-v2') || '{}') as Partial<Record<HomeSectionKey, string>>
    } catch (error) {
      console.error('Unable to read local homepage thumbnails.', error)
      return {}
    }
  })

  function scrollCards(direction: number) {
    cards.current?.scrollBy({ left: direction * 280, behavior: 'smooth' })
  }

  useEffect(() => {
    let active = true
    async function loadHeroImage() {
      if (isLocalPreviewSession()) {
        if (active) setHeroImage(getCachedHeroImage())
        return
      }
      try {
        const response = await fetch('/api/content/HOME_HERO_IMAGE')
        if (response.status === 404) {
          if (active) {
            setHeroImage(heroImageFallback)
            cacheHeroImage(null)
          }
          return
        }
        if (!response.ok) throw new Error('The saved homepage image could not be loaded.')
        const result: { content?: { blocks?: unknown } } = await response.json()
        const blocks = result.content?.blocks
        const savedImage = blocks && typeof blocks === 'object' && !Array.isArray(blocks) && 'image' in blocks && typeof blocks.image === 'string' && blocks.image.trim()
          ? blocks.image
          : null
        const displayImage = savedImage && (!savedImage.startsWith('data:image/') || savedImage.length <= maxInlineHeroImageLength)
          ? savedImage
          : null
        if (active) {
          setHeroImage(displayImage || heroImageFallback)
          cacheHeroImage(displayImage)
        }
      } catch (error) {
        console.error('Unable to load the saved homepage image.', error)
      }
    }
    void loadHeroImage()
    window.addEventListener('carmel-home-hero-updated', loadHeroImage)
    return () => {
      active = false
      window.removeEventListener('carmel-home-hero-updated', loadHeroImage)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function loadSectionImages() {
      if (isLocalPreviewSession()) {
        try {
          const saved = JSON.parse(localStorage.getItem('carmel-home-section-images-v2') || '{}') as Partial<Record<HomeSectionKey, string>>
          if (active) setSectionImages(saved)
        } catch (error) {
          console.error('Unable to load local homepage thumbnails.', error)
        }
        return
      }
      try {
        const response = await fetch('/api/content/HOME_SECTION_IMAGES')
        if (response.status === 404) {
          if (active) setSectionImages({})
          return
        }
        if (!response.ok) throw new Error('The saved homepage thumbnails could not be loaded.')
        const result: { content?: { blocks?: unknown } } = await response.json()
        const blocks = result.content?.blocks
        if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) throw new Error('Saved homepage thumbnails have an invalid format.')
        const blockValues = blocks as Record<string, unknown>
        const images = homeSectionCards.reduce<Partial<Record<HomeSectionKey, string>>>((saved, card) => {
          const savedImage = blockValues[card.key]
          if (typeof savedImage === 'string' && savedImage.trim()) saved[card.key] = savedImage
          return saved
        }, {})
        if (active) setSectionImages(images)
      } catch (error) {
        console.error('Unable to load saved homepage thumbnails.', error)
      }
    }
    void loadSectionImages()
    window.addEventListener('carmel-home-section-images-updated', loadSectionImages)
    return () => {
      active = false
      window.removeEventListener('carmel-home-section-images-updated', loadSectionImages)
    }
  }, [])

  return <div className="reference-home">
    <section className="reference-hero" id="home">
      <img src={heroImage} alt="Nuns gathered together in prayer" loading="eager" fetchPriority="high" decoding="sync" />
      <div className="reference-hero-overlay" />
      <div className="reference-hero-content">
        <p className="reference-kicker">A HOME FOR THE SEEKING HEART</p>
        <h1>Carmels in<br /><em>Communion</em></h1>
        <p>Welcome! You have arrived at the official website of the Philippine Federation of Discalced Carmelite Nuns for vocation promotion.</p>
        <div className="reference-actions"><Link className="reference-primary" to="/about">Explore</Link><Link className="reference-secondary" to="/monasteries">Meet our Monasteries</Link></div>
      </div>
    </section>
    <section className="reference-ticker"><strong>Philippine Federation of Discalced Carmelite Nuns</strong><div className="reference-ticker-window"><div className="reference-ticker-track">{[...cities, ...cities].map((city, index) => <span key={`${city}-${index}`}>{city}<i>·</i></span>)}</div></div></section>
    <section className="reference-discernment"><img src="/assets/images/whiteflowers.jpg" alt="White flowers in a garden" loading="lazy" decoding="async" /><div><h2>Is <b>GOD</b> calling you to be a<br /> Discalced Carmelite Nun?</h2><p>Are you discerning if God is calling you to Carmel? Let us assist you in your discernment as you explore the pages of this site.</p><Link className="reference-primary" to="/monasteries">Meet Our Monasteries</Link></div></section>
    <section className="reference-explore"><div className="reference-explore-heading"><div><p className="reference-kicker">FIND YOUR WAY IN</p><h2>Explore</h2></div><p>Learn about our charism, communities, and the women who have found a home in Carmel.</p></div><div className="reference-carousel"><button type="button" onClick={() => scrollCards(-1)} aria-label="Scroll left"><ArrowLeft size={18} /></button><div className="reference-cards" ref={cards}>{homeSectionCards.map(({ key, label, title, to, image }) => <Link className="reference-card" key={key} to={to}><img src={sectionImages[key] || image} alt="" loading="lazy" decoding="async" /><span>{label}</span><div><h3>{title}</h3><b>Learn More <ArrowRight size={14} /></b></div></Link>)}</div><button type="button" onClick={() => scrollCards(1)} aria-label="Scroll right"><ArrowRight size={18} /></button></div></section>
    <section className="reference-quote"><img src="/assets/images/pinkflower.jpg" alt="Pink flower" loading="lazy" decoding="async" /><div><p>Carmel symbolizes prayer. More than a geographical place, it is a sacred space in the cloister of the heart where the Carmelite nun encounters God.</p><Link className="reference-secondary" to="/contact">Contact us</Link></div></section>
  </div>
}
