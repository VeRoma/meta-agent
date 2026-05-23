'use client'

import { useFrame } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { useRef, useState } from 'react'
import * as THREE from 'three'

import { Platform } from './Platform'
import { useIntro } from '../context/IntroContext'
import { useQuality } from '../context/QualityContext'

export function PlatformWrapper() {
    const { entered } = useIntro()
    const { shadows } = useQuality()

    const platformRef = useRef<THREE.Group>(null)
    const [unmounted, setUnmounted] = useState(false)

    useFrame((_, delta) => {
        if (entered && platformRef.current && !unmounted) {
            platformRef.current.position.y -= 5 * delta
            if (platformRef.current.position.y < -10) {
                setUnmounted(true)
            }
        }
    })

    if (unmounted) return null

    return (
        <group ref={platformRef}>
            <Platform />
            {shadows && (
                <ContactShadows frames={1} position={[0, -1.1, 0]} opacity={0.5} scale={10} blur={2.5} far={1} />
            )}
        </group>
    )
}
