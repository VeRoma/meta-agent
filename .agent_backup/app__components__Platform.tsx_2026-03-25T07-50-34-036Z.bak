'use client'

import { MeshReflectorMaterial } from '@react-three/drei'
import { useQuality } from '../context/QualityContext' // Импортируем хук

export function Platform() {
    const { reflections } = useQuality() // Проверяем, включены ли отражения

    return (
        <group position={[0, -1.2, 0]}>

            {/* 1. Массивное матовое основание платформы */}
            <mesh receiveShadow position={[0, -0.001, 0]}>
                <cylinderGeometry args={[1, 1.05, 0.3, 64]} />
                <meshPhysicalMaterial
                    color="#050505" 
                    roughness={0.8} 
                    metalness={0.2}
                />
            </mesh>

            {/* 2. Обсидиановое зеркало (только верхняя крышка для идеального отражения) */}
            <mesh receiveShadow position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[1, 64]} />
                {reflections ? (
                    <MeshReflectorMaterial
                        blur={[300, 100]} // Мягкое размытие отражений по краям
                        resolution={1024} // Высокое разрешение текстуры отражений
                        mixBlur={1}
                        mixStrength={80}  // Мощность отражений
                        roughness={0.05}  // Максимально гладкий, как жидкое стекло
                        depthScale={1.2}
                        minDepthThreshold={0.4}
                        maxDepthThreshold={1.4}
                        color="#050505"     // Темный обсидиан
                        metalness={0.8}
                        mirror={1}
                    />
                ) : (
                    <meshPhysicalMaterial
                        color="#050505" 
                        roughness={0.05} 
                        metalness={0.9}
                        clearcoat={1.0} 
                        clearcoatRoughness={0.1}
                    />
                )}
            </mesh>

            {/* ... Кольца и свет оставляем без изменений ... */}
            <mesh position={[0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.8, 0.9, 64]} />
                <meshBasicMaterial color="#00ffff" toneMapped={false} />
            </mesh>

            <pointLight position={[0, 1, 0]} intensity={10} distance={3} color="#00ffff" />
        </group>
    )
}
