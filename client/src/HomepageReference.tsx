import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import './homepage-reference.css'

const exploreCards = [
  ['ABOUT US', 'THE FEDERATION', '/about', 'https://images.unsplash.com/photo-1438032005730-c779502df39b?auto=format&fit=crop&w=700&q=80'],
  ['CARMELIFE', '(Our vocation and Charism)', '/carmelife', 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=700&q=80'],
  ['CARMELIGHTS', '(Vocation Stories)', '/carmelights', 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=700&q=80'],
  ['CARMELINKS', '(News and Updates)', '/updates', 'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=700&q=80'],
  ['OUR MONASTERIES', 'Discover our communities', '/monasteries', 'https://images.unsplash.com/photo-1548625361-ec5e9e3c8f7a?auto=format&fit=crop&w=700&q=80'],
  ['DONATE', '(Share your blessings)', '/donations', 'https://images.unsplash.com/photo-1488900128323-21503983a07e?auto=format&fit=crop&w=700&q=80'],
  ['CONTACT US', '(Vocation Inquiries)', '/contact', 'https://images.unsplash.com/photo-1519834785169-98be25ec3f84?auto=format&fit=crop&w=700&q=80'],
] as const
const cities = ['Angeles', 'Bacolod', 'Baguio', 'Cagayan de Oro', 'Castillejos', 'Cebu', 'Davao', 'Gumaca', 'Infanta']

export default function HomepageReference() {
  const cards = useRef<HTMLDivElement>(null)
  const [heroImage, setHeroImage] = useState<string | null>(null)

  function scrollCards(direction: number) {
    cards.current?.scrollBy({ left: direction * 280, behavior: 'smooth' })
  }

  useEffect(() => {
    let active = true
    async function loadHeroImage() {
      try {
        const response = await fetch('/api/content/HOME_HERO_IMAGE')
        if (response.status === 404) {
          if (active) setHeroImage(null)
          return
        }
        if (!response.ok) throw new Error('The saved homepage image could not be loaded.')
        const result: { content?: { blocks?: unknown } } = await response.json()
        const blocks = result.content?.blocks
        const savedImage = blocks && typeof blocks === 'object' && !Array.isArray(blocks) && 'image' in blocks && typeof blocks.image === 'string' && blocks.image.trim()
          ? blocks.image
          : null
        if (active) setHeroImage(savedImage)
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

  return <div className="reference-home">
    <section className="reference-hero" id="home">
      {heroImage && <img src={heroImage} alt="Nuns gathered together in prayer" />}
      <div className="reference-hero-overlay" />
      <div className="reference-hero-content">
        <p className="reference-kicker">A HOME FOR THE SEEKING HEART</p>
        <h1>Carmels in<br /><em>Communion</em></h1>
        <p>Welcome! You have arrived at the official website of the Philippine Federation of Discalced Carmelite Nuns for vocation promotion.</p>
        <div className="reference-actions"><Link className="reference-primary" to="/about">Explore</Link><Link className="reference-secondary" to="/monasteries">Meet our Monasteries</Link></div>
      </div>
    </section>
    <section className="reference-ticker"><strong>Philippine Federation of Discalced Carmelite Nuns</strong><div className="reference-ticker-window"><div className="reference-ticker-track">{[...cities, ...cities].map((city, index) => <span key={`${city}-${index}`}>{city}<i>·</i></span>)}</div></div></section>
    <section className="reference-discernment"><img src="/assets/images/whiteflowers.jpg" alt="White flowers in a garden" /><div><h2>Is <b>GOD</b> calling you to be a<br /> Discalced Carmelite Nun?</h2><p>Are you discerning if God is calling you to Carmel? Let us assist you in your discernment as you explore the pages of this site.</p><Link className="reference-primary" to="/monasteries">Meet Our Monasteries</Link></div></section>
    <section className="reference-explore"><div className="reference-explore-heading"><div><p className="reference-kicker">FIND YOUR WAY IN</p><h2>Explore</h2></div><p>Learn about our charism, communities, and the women who have found a home in Carmel.</p></div><div className="reference-carousel"><button type="button" onClick={() => scrollCards(-1)} aria-label="Scroll left"><ArrowLeft size={18} /></button><div className="reference-cards" ref={cards}>{exploreCards.map(([label, title, to, image]) => <Link className="reference-card" key={title} to={to} style={{ backgroundImage: `linear-gradient(transparent 10%,rgba(20,10,4,.82)),url(${image})` }}><span>{label}</span><div><h3>{title}</h3><b>Learn More <ArrowRight size={14} /></b></div></Link>)}</div><button type="button" onClick={() => scrollCards(1)} aria-label="Scroll right"><ArrowRight size={18} /></button></div></section>
    <section className="reference-quote"><img src="/assets/images/pinkflower.jpg" alt="Pink flower" /><div><p>Carmel symbolizes prayer. More than a geographical place, it is a sacred space in the cloister of the heart where the Carmelite nun encounters God.</p><Link className="reference-secondary" to="/contact">Contact us</Link></div></section>
  </div>
}
